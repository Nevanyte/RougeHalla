//! Strict, atomic, typed reader for the frozen private-modules source witness (P-BOT-MODULES-1).
//!
//! `parity/policy/bot-private-modules/source.json` (`rh-bot-private-modules-source/1`, 255 cases / 3259 operations) is a
//! declared **method witness**, never a public intake path and never an oracle for native state. [verify.mjs] is the
//! executable grammar; this file converts every fact a replay consumes into the private module types *before* any native
//! Memory/RNG/path/module instance exists. Validation is side-effect free and atomic: a failure anywhere returns `Err`
//! and no partially converted case escapes; `load` only hands the caller a fully converted [Source].
//!
//! Expected outputs are kept as raw tagged [SVal] only (the comparison side), are never fed back into inputs, and no
//! expected Memory/module/Hunter state is installed here. Ordinary declared nonfinite clocks/geometry/config numbers are
//! rejected; the only exception is `env.learned` / `cfg.learned.entries`, the source-sanitized bias values
//! (docs/evidence/bot-private-modules-source/NUMERICS.md).
//!
//! Test-only: the enclosing `modules` module declares this file under `#[cfg(test)]`.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use super::chest_hunt::ChestHuntConfig;
use super::source_reader::{self, SVal, R};
use super::types::{
    AbilityDef, AbilityRank, CardCounts, Features, ModuleEvent, ModuleFighter, ModuleHud,
    ModuleMob, ModulePercept, ModuleSelf, SourceChest, WishTargeting, WishView,
};
use crate::bots::planning::{PlanCamp, PlanMap, PlanSpawn};
use crate::bots::types::{
    Appraisal, Attention, Cadence, Caution, ExGaussian, Hesitation, Intent, IntentBody,
    IntentTiming, MoveScatter, Orbwalk, PersonaParams, Route, TargetScatter, TierParams, PERSONAS,
    TIERS,
};
use rh_sim::mapdata::{GameMapData, MapExport, MapLayers};
use rh_sim::mapgen::map_hash::map_hash;
use rh_sim::{FactionId, TileMap, Vec2, WeaponId};

use super::super::data::MethodValue;
use super::super::memory::source_input::MemoryPercept;
use super::super::memory::{CampGeom, MemoryCommand, MemoryConfig, MemoryMap, MemoryTimedCommand};
use super::super::strategy::types::{Goal, HoldWhy, RoamWhy};

pub(crate) const SOURCE_FORMAT: &str = "rh-bot-private-modules-source/1";
pub(crate) const METHOD_VALUE_FORMAT: &str = "rh-method-value/1";
pub(crate) const SOURCE_RELATIVE_PATH: &str = "../../parity/policy/bot-private-modules/source.json";
pub(crate) const MAP_EXPORT_FORMAT: &str = "rh-map/2";

const MAX_DEPTH: usize = 200;
const FEATURES_MESSAGES: [&str; 11] = [
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
const SUITES: [&str; 7] = [
    "choice", "hunter", "chests", "planning", "wishes", "hazards", "registry",
];
const METHODS: [&str; 15] = [
    "observe",
    "noteSent",
    "recordChoice",
    "hook",
    "helper",
    "hunter.decide",
    "hunter.markDone",
    "hunter.tried",
    "hunter.inspect",
    "registry.reset",
    "registry.defaults",
    "registry.register",
    "registry.enabled",
    "registry.policySet",
    "registry.policyGet",
];
const GOAL_KINDS: [&str; 9] = [
    "idle", "farm", "hunt", "fight", "loot", "flee", "roam", "hold", "module",
];
const EVENT_KINDS: [&str; 16] = [
    "windup", "swing", "hit", "block", "stagger", "cancel", "projEnd", "death", "heal", "teleport",
    "bounty", "victory", "toast", "result", "private", "ext",
];
const WEAPON_NAMES: [&str; 6] = ["sword", "axe", "shield", "bow", "wand", "fists"];
const FACTION_NAMES: [&str; 5] = ["fire", "sentenced", "plague", "frost", "holy"];
const STATUS_NAMES: [&str; 3] = ["alive", "dead", "mia"];
const MOB_KINDS: [&str; 4] = ["mob", "elite", "dummy", "npc"];
const COMMAND_TYPES: [&str; 11] = [
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
const HOOK_NAMES: [&str; 6] = ["enabled", "observe", "goals", "intents", "act", "adjust"];

fn err(path: &str, message: impl Into<String>) -> String {
    format!("{path}: {}", message.into())
}

fn kind_of(value: &SVal) -> &'static str {
    match value {
        SVal::Undefined => "undefined",
        SVal::Null => "null",
        SVal::Bool(_) => "bool",
        SVal::Num(_) => "number",
        SVal::Str(_) => "string",
        SVal::Arr(_) => "array",
        SVal::Map(_) => "map",
        SVal::Set(_) => "set",
        SVal::Obj(_) => "object",
        SVal::U8(_) => "u8",
        SVal::Instance { .. } => "instance",
        SVal::Callable => "callable",
    }
}

fn object<'a>(value: &'a SVal, path: &str) -> R<&'a [(String, SVal)]> {
    match value {
        SVal::Obj(entries) => Ok(entries),
        other => Err(err(
            path,
            format!("expected an object, got {}", kind_of(other)),
        )),
    }
}

fn field<'a>(value: &'a SVal, name: &str, path: &str) -> R<&'a SVal> {
    match value {
        SVal::Obj(entries) => entries
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value)
            .ok_or_else(|| err(path, format!("missing consumed fact {name}"))),
        other => Err(err(
            path,
            format!("expected an object, got {}", kind_of(other)),
        )),
    }
}

fn optional<'a>(value: &'a SVal, name: &str) -> Option<&'a SVal> {
    match value {
        SVal::Obj(entries) => entries
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value),
        _ => None,
    }
}

fn string_field(value: &SVal, name: &str, path: &str) -> R<String> {
    match field(value, name, path)? {
        SVal::Str(text) => Ok(text.clone()),
        other => Err(err(
            &format!("{path}.{name}"),
            format!("expected a string, got {}", kind_of(other)),
        )),
    }
}

fn finite_number(value: &SVal, name: &str, path: &str) -> R<f64> {
    match field(value, name, path)? {
        SVal::Num(number) if number.is_finite() => Ok(*number),
        other => Err(err(
            &format!("{path}.{name}"),
            format!("expected a finite declared number, got {}", kind_of(other)),
        )),
    }
}

fn finite_number_value(value: &SVal, path: &str) -> R<f64> {
    match value {
        SVal::Num(number) if number.is_finite() => Ok(*number),
        other => Err(err(
            path,
            format!("expected a finite declared number, got {}", kind_of(other)),
        )),
    }
}

fn bool_field(value: &SVal, name: &str, path: &str) -> R<bool> {
    match field(value, name, path)? {
        SVal::Bool(flag) => Ok(*flag),
        other => Err(err(
            &format!("{path}.{name}"),
            format!("expected a bool, got {}", kind_of(other)),
        )),
    }
}

fn array_field<'a>(value: &'a SVal, name: &str, path: &str) -> R<&'a [SVal]> {
    match field(value, name, path)? {
        SVal::Arr(rows) => Ok(rows),
        other => Err(err(
            &format!("{path}.{name}"),
            format!("expected an array, got {}", kind_of(other)),
        )),
    }
}

fn closed(value: &SVal, keys: &[&str], path: &str) -> R<()> {
    let entries = object(value, path)?;
    for (key, _) in entries {
        if !keys.contains(&key.as_str()) {
            return Err(err(path, format!("unsupported field {key}")));
        }
    }
    for key in keys {
        if !entries.iter().any(|(name, _)| name == key) {
            return Err(err(path, format!("missing consumed fact {key}")));
        }
    }
    Ok(())
}

/// Reject only unknown fields (the declared schema's optional set stays optional).
fn allowed_keys(value: &SVal, keys: &[&str], path: &str) -> R<()> {
    let entries = object(value, path)?;
    for (key, _) in entries {
        if !keys.contains(&key.as_str()) {
            return Err(err(path, format!("unsupported field {key}")));
        }
    }
    Ok(())
}

fn require_fields(value: &SVal, keys: &[&str], path: &str) -> R<()> {
    object(value, path)?;
    for key in keys {
        if optional(value, key).is_none() {
            return Err(err(path, format!("missing consumed fact {key}")));
        }
    }
    Ok(())
}

fn one_of(text: &str, values: &[&str], path: &str) -> R<String> {
    if values.contains(&text) {
        Ok(text.to_string())
    } else {
        Err(err(path, format!("unsupported enum value {text}")))
    }
}

fn enum_field(value: &SVal, name: &str, values: &[&str], path: &str) -> R<String> {
    one_of(
        &string_field(value, name, path)?,
        values,
        &format!("{path}.{name}"),
    )
}

/// Non-negative integer, no fractional part, at most `max`, never a silent `f64 as u64` truncation.
fn uint_field(value: &SVal, name: &str, max: u64, path: &str) -> R<u64> {
    let number = finite_number(value, name, path)?;
    if number >= 0. && number.fract() == 0. && number <= max as f64 {
        Ok(number as u64)
    } else {
        Err(err(
            &format!("{path}.{name}"),
            format!("expected an integer in 0..={max}, got {number}"),
        ))
    }
}

fn uint_value(value: &SVal, max: u64, path: &str) -> R<u64> {
    let number = finite_number_value(value, path)?;
    if number >= 0. && number.fract() == 0. && number <= max as f64 {
        Ok(number as u64)
    } else {
        Err(err(
            path,
            format!("expected an integer in 0..={max}, got {number}"),
        ))
    }
}

fn string_array(value: &SVal, name: &str, path: &str) -> R<Vec<String>> {
    array_field(value, name, path)?
        .iter()
        .enumerate()
        .map(|(index, row)| match row {
            SVal::Str(text) => Ok(text.clone()),
            other => Err(err(
                &format!("{path}.{name}[{index}]"),
                format!("expected a string, got {}", kind_of(other)),
            )),
        })
        .collect()
}

fn point_field(value: &SVal, name: &str, path: &str) -> R<Vec2> {
    let at = field(value, name, path)?;
    let path = format!("{path}.{name}");
    closed(at, &["x", "y"], &path)?;
    Ok(Vec2::new(
        finite_number(at, "x", &path)?,
        finite_number(at, "y", &path)?,
    ))
}

fn point_value(value: &SVal, path: &str) -> R<Vec2> {
    closed(value, &["x", "y"], path)?;
    Ok(Vec2::new(
        finite_number(value, "x", path)?,
        finite_number(value, "y", path)?,
    ))
}

fn weapon_field(value: &SVal, name: &str, path: &str) -> R<Option<WeaponId>> {
    match field(value, name, path)? {
        SVal::Null => Ok(None),
        SVal::Str(text) => WeaponId::parse(text)
            .map(Some)
            .ok_or_else(|| err(&format!("{path}.{name}"), format!("unknown weapon {text}"))),
        other => Err(err(
            &format!("{path}.{name}"),
            format!("expected a weapon string|null, got {}", kind_of(other)),
        )),
    }
}

fn weapon_value(value: &SVal, path: &str) -> R<WeaponId> {
    match value {
        SVal::Str(text) => one_of(text, &WEAPON_NAMES, path)
            .map(|_| WeaponId::parse(text).expect("checked known weapon name")),
        other => Err(err(
            path,
            format!("expected a weapon string, got {}", kind_of(other)),
        )),
    }
}

fn opt_weapon_value(value: &SVal, path: &str) -> R<Option<WeaponId>> {
    match value {
        SVal::Null => Ok(None),
        SVal::Undefined => Ok(None),
        SVal::Str(text) => WeaponId::parse(text)
            .map(Some)
            .ok_or_else(|| err(path, format!("unknown weapon {text}"))),
        other => Err(err(
            path,
            format!("expected a weapon string|null, got {}", kind_of(other)),
        )),
    }
}

fn faction_value(value: &SVal, path: &str) -> R<FactionId> {
    match value {
        SVal::Str(text) => FactionId::parse(text)
            .ok_or_else(|| err(path, format!("unknown declared faction {text}"))),
        other => Err(err(
            path,
            format!("expected a faction string, got {}", kind_of(other)),
        )),
    }
}

fn opt_faction_value(value: &SVal, path: &str) -> R<Option<FactionId>> {
    match value {
        SVal::Null => Ok(None),
        SVal::Undefined => Ok(None),
        _ => faction_value(value, path).map(Some),
    }
}

fn weapon_pair(value: &SVal, name: &str, path: &str) -> R<[Option<WeaponId>; 2]> {
    let rows = array_field(value, name, path)?;
    let path = format!("{path}.{name}");
    if rows.len() != 2 {
        return Err(err(
            &path,
            format!(
                "the source weapon tuple has exactly two slots, got {}",
                rows.len()
            ),
        ));
    }
    Ok([
        opt_weapon_value(&rows[0], &format!("{path}[0]"))?,
        opt_weapon_value(&rows[1], &format!("{path}[1]"))?,
    ])
}

fn card_counts(value: &SVal, path: &str) -> R<CardCounts> {
    let entries = object(value, path)?;
    let mut counts = CardCounts::default();
    for (id, count) in entries {
        let number = finite_number_value(count, &format!("{path}.{id}"))?;
        counts.set(id.clone(), number);
    }
    Ok(counts)
}

// ---------------------------------------------------------------------------------------------------------------------
// Raw JSON: structure scan with decoded-key duplicate rejection, then serde_json for the owned value.

/// Strict raw object parse: ordered JSON grammar checked before any value is converted, with duplicate object keys
/// rejected by their *decoded* UTF-16 identity (so `"a"` and `"\u0061"` collide), depth bounded, and no trailing bytes.
/// Mirrors verify.mjs `parseRaw`.
pub(crate) fn parse_raw(text: &str) -> R<Value> {
    scan_raw(text)?;
    serde_json::from_str(text).map_err(|error| format!("raw JSON: {error}"))
}

/// `build_body` from text (strict raw parse + full conversion).
pub(crate) fn body_from_str(text: &str) -> R<Source> {
    let raw = parse_raw(text)?;
    build_body(&raw)
}

struct RawScan<'a> {
    bytes: &'a [u8],
    at: usize,
}

fn utf8_width(byte: u8) -> Option<usize> {
    match byte {
        0x00..=0x7f => Some(1),
        0xc2..=0xdf => Some(2),
        0xe0..=0xef => Some(3),
        0xf0..=0xf4 => Some(4),
        _ => None,
    }
}

impl<'a> RawScan<'a> {
    fn skip_ws(&mut self) {
        while matches!(
            self.bytes.get(self.at),
            Some(b' ') | Some(b'\t') | Some(b'\n') | Some(b'\r')
        ) {
            self.at += 1;
        }
    }

    fn expect(&mut self, byte: u8) -> R<()> {
        self.skip_ws();
        match self.bytes.get(self.at) {
            Some(found) if *found == byte => {
                self.at += 1;
                Ok(())
            }
            _ => Err(format!(
                "raw JSON: expected {:?} at byte {}",
                byte as char, self.at
            )),
        }
    }

    fn value(&mut self, depth: usize) -> R<()> {
        if depth > MAX_DEPTH {
            return Err(format!("raw JSON: depth limit {MAX_DEPTH} exceeded"));
        }
        self.skip_ws();
        let Some(byte) = self.bytes.get(self.at).copied() else {
            return Err("raw JSON: unexpected end of input".into());
        };
        match byte {
            b'{' => self.object(depth),
            b'[' => self.array(depth),
            b'"' => self.string_units().map(|_| ()),
            b't' => self.literal("true"),
            b'f' => self.literal("false"),
            b'n' => self.literal("null"),
            b'-' | b'0'..=b'9' => self.number(),
            other => Err(format!(
                "raw JSON: unexpected byte {:?} at byte {}",
                other as char, self.at
            )),
        }
    }

    fn literal(&mut self, word: &str) -> R<()> {
        if self.bytes[self.at..].starts_with(word.as_bytes()) {
            self.at += word.len();
            match self.bytes.get(self.at) {
                None | Some(b' ' | b'\t' | b'\n' | b'\r' | b',' | b']' | b'}') => Ok(()),
                Some(other) => Err(format!(
                    "raw JSON: invalid token after {word}: {:?}",
                    *other as char
                )),
            }
        } else {
            Err(format!(
                "raw JSON: expected token {word} at byte {}",
                self.at
            ))
        }
    }

    fn object(&mut self, depth: usize) -> R<()> {
        self.at += 1; // '{'
        self.skip_ws();
        if self.bytes.get(self.at) == Some(&b'}') {
            self.at += 1;
            return Ok(());
        }
        let mut seen: BTreeSet<Vec<u16>> = BTreeSet::new();
        loop {
            self.skip_ws();
            if self.bytes.get(self.at) != Some(&b'"') {
                return Err(format!(
                    "raw JSON: expected an object key at byte {}",
                    self.at
                ));
            }
            let key = self.string_units()?;
            if !seen.insert(key.clone()) {
                return Err(format!(
                    "raw JSON: duplicate raw JSON key {:?} at byte {}",
                    String::from_utf16_lossy(&key),
                    self.at
                ));
            }
            self.expect(b':')?;
            self.value(depth + 1)?;
            self.skip_ws();
            match self.bytes.get(self.at) {
                Some(b',') => self.at += 1,
                Some(b'}') => {
                    self.at += 1;
                    return Ok(());
                }
                _ => {
                    return Err(format!(
                        "raw JSON: expected ',' or '}}' at byte {}",
                        self.at
                    ))
                }
            }
        }
    }

    fn array(&mut self, depth: usize) -> R<()> {
        self.at += 1; // '['
        self.skip_ws();
        if self.bytes.get(self.at) == Some(&b']') {
            self.at += 1;
            return Ok(());
        }
        loop {
            self.value(depth + 1)?;
            self.skip_ws();
            match self.bytes.get(self.at) {
                Some(b',') => self.at += 1,
                Some(b']') => {
                    self.at += 1;
                    return Ok(());
                }
                _ => return Err(format!("raw JSON: expected ',' or ']' at byte {}", self.at)),
            }
        }
    }

    /// The decoded UTF-16 code units of a JSON string (ECMAScript string identity; lone surrogates stay distinct).
    fn string_units(&mut self) -> R<Vec<u16>> {
        if self.bytes.get(self.at) != Some(&b'"') {
            return Err(format!("raw JSON: expected a string at byte {}", self.at));
        }
        self.at += 1;
        let mut units: Vec<u16> = Vec::new();
        loop {
            let Some(byte) = self.bytes.get(self.at).copied() else {
                return Err("raw JSON: unterminated string".into());
            };
            match byte {
                b'"' => {
                    self.at += 1;
                    return Ok(units);
                }
                b'\\' => {
                    self.at += 1;
                    let Some(escape) = self.bytes.get(self.at).copied() else {
                        return Err("raw JSON: unterminated escape".into());
                    };
                    self.at += 1;
                    match escape {
                        b'"' => units.push(0x22),
                        b'\\' => units.push(0x5c),
                        b'/' => units.push(0x2f),
                        b'b' => units.push(0x08),
                        b'f' => units.push(0x0c),
                        b'n' => units.push(0x0a),
                        b'r' => units.push(0x0d),
                        b't' => units.push(0x09),
                        b'u' => {
                            let mut unit: u16 = 0;
                            for _ in 0..4 {
                                let Some(digit) = self.bytes.get(self.at).copied() else {
                                    return Err("raw JSON: short \\u escape".into());
                                };
                                let value = match digit {
                                    b'0'..=b'9' => digit - b'0',
                                    b'a'..=b'f' => digit - b'a' + 10,
                                    b'A'..=b'F' => digit - b'A' + 10,
                                    _ => {
                                        return Err(format!(
                                            "raw JSON: invalid \\u escape at byte {}",
                                            self.at
                                        ))
                                    }
                                };
                                unit = (unit << 4) | u16::from(value);
                                self.at += 1;
                            }
                            units.push(unit);
                        }
                        _ => {
                            return Err(format!("raw JSON: invalid escape at byte {}", self.at - 1))
                        }
                    }
                }
                0x00..=0x1f => {
                    return Err(format!(
                        "raw JSON: unescaped control character at byte {}",
                        self.at
                    ))
                }
                0x20..=0x7f => {
                    units.push(u16::from(byte));
                    self.at += 1;
                }
                _ => {
                    let start = self.at;
                    let width = utf8_width(byte)
                        .ok_or_else(|| format!("raw JSON: invalid UTF-8 at byte {start}"))?;
                    let slice = self
                        .bytes
                        .get(start..start + width)
                        .ok_or_else(|| format!("raw JSON: truncated UTF-8 at byte {start}"))?;
                    let text = std::str::from_utf8(slice)
                        .map_err(|_| format!("raw JSON: invalid UTF-8 at byte {start}"))?;
                    let ch = text
                        .chars()
                        .next()
                        .ok_or_else(|| format!("raw JSON: invalid UTF-8 at byte {start}"))?;
                    let mut buffer = [0u16; 2];
                    units.extend_from_slice(ch.encode_utf16(&mut buffer));
                    self.at = start + width;
                }
            }
        }
    }

    fn number(&mut self) -> R<()> {
        if self.bytes.get(self.at) == Some(&b'-') {
            self.at += 1;
        }
        match self.bytes.get(self.at) {
            Some(b'0') => self.at += 1,
            Some(b'1'..=b'9') => {
                while matches!(self.bytes.get(self.at), Some(b'0'..=b'9')) {
                    self.at += 1;
                }
            }
            _ => return Err(format!("raw JSON: invalid number at byte {}", self.at)),
        }
        if self.bytes.get(self.at) == Some(&b'.') {
            self.at += 1;
            let digits = self.at;
            while matches!(self.bytes.get(self.at), Some(b'0'..=b'9')) {
                self.at += 1;
            }
            if self.at == digits {
                return Err(format!(
                    "raw JSON: expected fraction digits at byte {}",
                    self.at
                ));
            }
        }
        if matches!(self.bytes.get(self.at), Some(b'e') | Some(b'E')) {
            self.at += 1;
            if matches!(self.bytes.get(self.at), Some(b'+') | Some(b'-')) {
                self.at += 1;
            }
            let digits = self.at;
            while matches!(self.bytes.get(self.at), Some(b'0'..=b'9')) {
                self.at += 1;
            }
            if self.at == digits {
                return Err(format!(
                    "raw JSON: expected exponent digits at byte {}",
                    self.at
                ));
            }
        }
        match self.bytes.get(self.at) {
            None | Some(b' ' | b'\t' | b'\n' | b'\r' | b',' | b']' | b'}') => Ok(()),
            _ => Err(format!(
                "raw JSON: invalid number continuation at byte {}",
                self.at
            )),
        }
    }
}

fn scan_raw(text: &str) -> R<()> {
    let mut scan = RawScan {
        bytes: text.as_bytes(),
        at: 0,
    };
    scan.value(0)?;
    scan.skip_ws();
    if scan.at != scan.bytes.len() {
        return Err(format!("raw JSON: trailing content at byte {}", scan.at));
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------------
// Tagged `rh-method-value/1` decode. Input mode is the declared caller data; diagnostic mode is expected/observed output.

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Input,
    Diagnostic,
}

fn tag_parts<'a>(value: &'a Value, path: &str) -> R<(&'a str, &'a serde_json::Map<String, Value>)> {
    let object = value
        .as_object()
        .ok_or_else(|| err(path, "expected a tagged method-value object"))?;
    let tag = object
        .get("$")
        .and_then(Value::as_str)
        .ok_or_else(|| err(path, "missing $ method-value tag"))?;
    Ok((tag, object))
}

fn exact_tag_keys(object: &serde_json::Map<String, Value>, allowed: &[&str], path: &str) -> R<()> {
    for key in object.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(err(
                path,
                format!("unexpected method-value tag field {key}"),
            ));
        }
    }
    for key in allowed {
        if !object.contains_key(*key) {
            return Err(err(path, format!("missing method-value tag field {key}")));
        }
    }
    Ok(())
}

/// SameValueZero: the source Map/Set key equality (signed zero and NaN collide).
fn same_value_zero(a: &SVal, b: &SVal) -> bool {
    match (a, b) {
        (SVal::Num(x), SVal::Num(y)) => {
            x.to_bits() == y.to_bits() || (x.is_nan() && y.is_nan()) || x == y
        }
        _ => source_reader::same(a, b),
    }
}

fn raw_json_number(value: &Value, path: &str) -> R<f64> {
    let number = value
        .as_f64()
        .ok_or_else(|| err(path, "expected a JSON number"))?;
    if !number.is_finite() {
        return Err(err(path, "JSON number outside the finite double range"));
    }
    if number == 0. && number.is_sign_negative() {
        return Err(err(
            path,
            "raw -0 is not a declared method value (use the {$:'number',value:'-0'} tag)",
        ));
    }
    Ok(number)
}

fn decode(value: &Value, path: &str, mode: Mode) -> R<SVal> {
    match value {
        Value::Null => Ok(SVal::Null),
        Value::Bool(flag) => Ok(SVal::Bool(*flag)),
        Value::Number(_) => Ok(SVal::Num(raw_json_number(value, path)?)),
        Value::String(text) => Ok(SVal::Str(text.clone())),
        Value::Array(_) => Err(err(
            path,
            "untagged JSON array is not a method value (wrap it in {$:'array',values:[...]})",
        )),
        Value::Object(_) => {
            let (tag, object) = tag_parts(value, path)?;
            match tag {
                "undefined" => {
                    exact_tag_keys(object, &["$"], path)?;
                    Ok(SVal::Undefined)
                }
                "number" => {
                    exact_tag_keys(object, &["$", "value"], path)?;
                    let raw = object
                        .get("value")
                        .and_then(Value::as_str)
                        .ok_or_else(|| err(path, "number tag value must be a string"))?;
                    match raw {
                        "-0" => Ok(SVal::Num(-0.0)),
                        "NaN" => Ok(SVal::Num(f64::NAN)),
                        "+Infinity" => Ok(SVal::Num(f64::INFINITY)),
                        "-Infinity" => Ok(SVal::Num(f64::NEG_INFINITY)),
                        other => Err(err(path, format!("unsupported number tag value {other}"))),
                    }
                }
                "callable" => {
                    exact_tag_keys(object, &["$"], path)?;
                    if mode != Mode::Diagnostic {
                        return Err(err(
                            path,
                            "callable diagnostics are not declared input values",
                        ));
                    }
                    Ok(SVal::Callable)
                }
                "hole" => Err(err(
                    path,
                    "array-hole diagnostics are outside the finite fixture representation",
                )),
                "array" | "set" | "u8" => {
                    exact_tag_keys(object, &["$", "values"], path)?;
                    let values = object
                        .get("values")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "tag values must be an array"))?;
                    let mut out: Vec<SVal> = Vec::with_capacity(values.len());
                    for (index, entry) in values.iter().enumerate() {
                        let entry_path = format!("{path}.values[{index}]");
                        let member = decode(entry, &entry_path, mode)?;
                        if tag == "set" && out.iter().any(|seen| same_value_zero(seen, &member)) {
                            return Err(err(&entry_path, "duplicate Set member"));
                        }
                        out.push(member);
                    }
                    match tag {
                        "u8" => {
                            let mut bytes = Vec::with_capacity(out.len());
                            for (index, member) in out.iter().enumerate() {
                                match member {
                                    SVal::Num(number)
                                        if number.is_finite()
                                            && *number >= 0.
                                            && *number <= 255.
                                            && number.fract() == 0. =>
                                    {
                                        bytes.push(*number as u8)
                                    }
                                    other => {
                                        return Err(err(
                                            &format!("{path}.values[{index}]"),
                                            format!(
                                                "u8 value must be an integer 0..=255, got {}",
                                                kind_of(other)
                                            ),
                                        ))
                                    }
                                }
                            }
                            Ok(SVal::U8(bytes))
                        }
                        "set" => Ok(SVal::Set(out)),
                        _ => Ok(SVal::Arr(out)),
                    }
                }
                "map" => {
                    exact_tag_keys(object, &["$", "entries"], path)?;
                    let entries = object
                        .get("entries")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "map tag entries must be an array"))?;
                    let mut out: Vec<(SVal, SVal)> = Vec::with_capacity(entries.len());
                    for (index, entry) in entries.iter().enumerate() {
                        let entry_path = format!("{path}.entries[{index}]");
                        let pair = entry
                            .as_array()
                            .filter(|pair| pair.len() == 2)
                            .ok_or_else(|| err(&entry_path, "map entry must be [key,value]"))?;
                        let key = decode(&pair[0], &format!("{entry_path}.key"), mode)?;
                        if !matches!(
                            key,
                            SVal::Undefined
                                | SVal::Null
                                | SVal::Bool(_)
                                | SVal::Num(_)
                                | SVal::Str(_)
                        ) {
                            return Err(err(
                                &format!("{entry_path}.key"),
                                "fixture Map key must be primitive",
                            ));
                        }
                        if out.iter().any(|(seen, _)| same_value_zero(seen, &key)) {
                            return Err(err(&entry_path, "duplicate Map key"));
                        }
                        let member = decode(&pair[1], &format!("{entry_path}.value"), mode)?;
                        out.push((key, member));
                    }
                    Ok(SVal::Map(out))
                }
                "object" => {
                    exact_tag_keys(object, &["$", "entries"], path)?;
                    let entries = object
                        .get("entries")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "object tag entries must be an array"))?;
                    let mut out: Vec<(String, SVal)> = Vec::with_capacity(entries.len());
                    for (index, entry) in entries.iter().enumerate() {
                        let entry_path = format!("{path}.entries[{index}]");
                        let pair = entry
                            .as_array()
                            .filter(|pair| pair.len() == 2)
                            .ok_or_else(|| err(&entry_path, "object entry must be [key,value]"))?;
                        let key = pair[0]
                            .as_str()
                            .ok_or_else(|| {
                                err(&format!("{entry_path}.key"), "object key must be a string")
                            })?
                            .to_string();
                        if out.iter().any(|(seen, _)| seen == &key) {
                            return Err(err(&entry_path, "duplicate object key"));
                        }
                        let member = decode(&pair[1], &format!("{entry_path}.value"), mode)?;
                        out.push((key, member));
                    }
                    Ok(SVal::Obj(out))
                }
                "instance" => {
                    if mode != Mode::Diagnostic {
                        return Err(err(
                            path,
                            "instance diagnostics are not declared input values",
                        ));
                    }
                    exact_tag_keys(object, &["$", "name", "entries"], path)?;
                    let name = object
                        .get("name")
                        .and_then(Value::as_str)
                        .filter(|name| !name.is_empty())
                        .ok_or_else(|| err(path, "instance name must be a non-empty string"))?
                        .to_string();
                    let entries = object
                        .get("entries")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "instance tag entries must be an array"))?;
                    let mut out: Vec<(String, SVal)> = Vec::with_capacity(entries.len());
                    for (index, entry) in entries.iter().enumerate() {
                        let entry_path = format!("{path}.entries[{index}]");
                        let pair =
                            entry
                                .as_array()
                                .filter(|pair| pair.len() == 2)
                                .ok_or_else(|| {
                                    err(&entry_path, "instance entry must be [key,value]")
                                })?;
                        let key = pair[0]
                            .as_str()
                            .ok_or_else(|| {
                                err(
                                    &format!("{entry_path}.key"),
                                    "instance key must be a string",
                                )
                            })?
                            .to_string();
                        if out.iter().any(|(seen, _)| seen == &key) {
                            return Err(err(&entry_path, "duplicate instance key"));
                        }
                        let member = decode(&pair[1], &format!("{entry_path}.value"), mode)?;
                        out.push((key, member));
                    }
                    Ok(SVal::Instance { name, entries: out })
                }
                other => Err(err(path, format!("unsupported method-value tag {other}"))),
            }
        }
    }
}

fn decode_input(value: &Value, path: &str) -> R<SVal> {
    decode(value, path, Mode::Input)
}

fn decode_diagnostic(value: &Value, path: &str) -> R<SVal> {
    decode(value, path, Mode::Diagnostic)
}

// ---------------------------------------------------------------------------------------------------------------------
// Declared -> owned conversions.

/// Lossless tagged SVal -> `data::MethodValue` (Undefined/Null/Bool/Num bit-exact/Str/Arr/Obj). Maps/Sets/u8/instances and
/// callables are diagnostics-only and have no MethodValue spelling; a declared record containing one is refused.
fn method_value(value: &SVal, path: &str) -> R<MethodValue> {
    Ok(match value {
        SVal::Undefined => MethodValue::Undefined,
        SVal::Null => MethodValue::Null,
        SVal::Bool(flag) => MethodValue::Bool(*flag),
        SVal::Num(number) => MethodValue::Num(*number),
        SVal::Str(text) => MethodValue::Str(text.clone()),
        SVal::Arr(rows) => MethodValue::Arr(
            rows.iter()
                .enumerate()
                .map(|(index, row)| method_value(row, &format!("{path}[{index}]")))
                .collect::<R<Vec<_>>>()?,
        ),
        SVal::Obj(entries) => MethodValue::Obj(
            entries
                .iter()
                .map(|(key, value)| {
                    Ok((key.clone(), method_value(value, &format!("{path}.{key}"))?))
                })
                .collect::<R<Vec<_>>>()?,
        ),
        other => {
            return Err(err(
                path,
                format!(
                    "declared record holds {} which has no data::MethodValue spelling",
                    kind_of(other)
                ),
            ))
        }
    })
}

/// Tagged SVal -> plain JSON the admitted Memory reader consumes. `undefined` keeps its explicit
/// `{"$rh":"undefined"}` spelling; every other finite scalar/array/object maps directly. Nonfinite or
/// non-JSON values are refused, never coerced.
fn sval_to_json(value: &SVal, path: &str) -> R<Value> {
    Ok(match value {
        SVal::Undefined => {
            let mut object = serde_json::Map::new();
            object.insert("$rh".into(), Value::String("undefined".into()));
            Value::Object(object)
        }
        SVal::Null => Value::Null,
        SVal::Bool(flag) => Value::Bool(*flag),
        SVal::Num(number) => {
            if !number.is_finite() {
                return Err(err(
                    path,
                    "nonfinite value has no plain-JSON spelling for the Memory reader",
                ));
            }
            // Integral source numbers keep an integer JSON spelling so the admitted DTOs (u8/u32/u64/i32/... and their
            // plain f64 fields alike) deserialize exactly; fractional values stay binary64.
            if number.fract() == 0.
                && !(*number == 0. && number.is_sign_negative())
                && number.abs() <= 9_007_199_254_740_992.
            {
                if *number >= 0. {
                    Value::from(*number as u64)
                } else {
                    Value::from(*number as i64)
                }
            } else {
                Value::Number(
                    serde_json::Number::from_f64(*number)
                        .ok_or_else(|| err(path, "number out of JSON range"))?,
                )
            }
        }
        SVal::Str(text) => Value::String(text.clone()),
        SVal::Arr(rows) => Value::Array(
            rows.iter()
                .enumerate()
                .map(|(index, row)| sval_to_json(row, &format!("{path}[{index}]")))
                .collect::<R<Vec<_>>>()?,
        ),
        SVal::Obj(entries) => {
            let mut object = serde_json::Map::new();
            for (key, member) in entries {
                object.insert(key.clone(), sval_to_json(member, &format!("{path}.{key}"))?);
            }
            Value::Object(object)
        }
        SVal::U8(bytes) => Value::Array(bytes.iter().map(|byte| Value::from(*byte)).collect()),
        other => {
            return Err(err(
                path,
                format!("{} cannot be read as plain declared JSON", kind_of(other)),
            ))
        }
    })
}

/// Plain envelope JSON -> SVal for the few non-tagged declared facts (e.g. `initial.target`, `identity`, draw counts).
fn plain_to_sval(value: &Value, path: &str) -> R<SVal> {
    match value {
        Value::Null => Ok(SVal::Null),
        Value::Bool(flag) => Ok(SVal::Bool(*flag)),
        Value::Number(_) => Ok(SVal::Num(raw_json_number(value, path)?)),
        Value::String(text) => Ok(SVal::Str(text.clone())),
        Value::Array(rows) => Ok(SVal::Arr(
            rows.iter()
                .enumerate()
                .map(|(index, row)| plain_to_sval(row, &format!("{path}[{index}]")))
                .collect::<R<Vec<_>>>()?,
        )),
        Value::Object(entries) => {
            let mut out: Vec<(String, SVal)> = Vec::with_capacity(entries.len());
            for (key, member) in entries {
                out.push((
                    key.clone(),
                    plain_to_sval(member, &format!("{path}.{key}"))?,
                ));
            }
            Ok(SVal::Obj(out))
        }
    }
}

fn check_finite(value: &SVal, path: &str) -> R<()> {
    match value {
        SVal::Num(number) if !number.is_finite() => Err(err(
            path,
            "nonfinite declared number is outside the finite source profile",
        )),
        SVal::Arr(rows) => rows
            .iter()
            .enumerate()
            .try_for_each(|(index, row)| check_finite(row, &format!("{path}[{index}]"))),
        SVal::Obj(entries) => entries
            .iter()
            .try_for_each(|(key, member)| check_finite(member, &format!("{path}.{key}"))),
        SVal::Map(entries) => entries
            .iter()
            .enumerate()
            .try_for_each(|(index, (key, member))| {
                let path = format!("{path}.entries[{index}]");
                check_finite(key, &format!("{path}.key"))?;
                check_finite(member, &format!("{path}.value"))
            }),
        SVal::Set(rows) => rows
            .iter()
            .enumerate()
            .try_for_each(|(index, row)| check_finite(row, &format!("{path}[{index}]"))),
        SVal::U8(_) | SVal::Instance { .. } | SVal::Callable => Ok(()),
        _ => Ok(()),
    }
}

/// `declaredFinite` from verify.mjs: the whole declared method record is finite except the source-sanitized
/// `env.learned` bias values (`NaN`/`±Infinity` are legitimate there, and only there).
fn check_declaration_finite(declaration: &SVal, path: &str) -> R<()> {
    let entries = object(declaration, path)?;
    for (key, member) in entries {
        if key == "env" {
            let env_path = format!("{path}.env");
            let env_entries = object(member, &env_path)?;
            for (env_key, env_member) in env_entries {
                if env_key == "learned" {
                    let learned_path = format!("{env_path}.learned");
                    let SVal::Arr(pairs) = env_member else {
                        return Err(err(
                            &learned_path,
                            "env.learned must be an array of bias pairs",
                        ));
                    };
                    for (index, pair) in pairs.iter().enumerate() {
                        let pair_path = format!("{learned_path}[{index}]");
                        let SVal::Arr(values) = pair else {
                            return Err(err(&pair_path, "learned bias must be a [key,value] pair"));
                        };
                        if values.len() != 2 {
                            return Err(err(&pair_path, "learned bias must be a [key,value] pair"));
                        }
                        if !matches!(values[0], SVal::Str(_)) {
                            return Err(err(
                                &format!("{pair_path}[0]"),
                                "learned bias key must be a string",
                            ));
                        }
                        if !matches!(values[1], SVal::Num(_)) {
                            return Err(err(
                                &format!("{pair_path}[1]"),
                                "learned bias value must be a number",
                            ));
                        }
                    }
                } else {
                    check_finite(env_member, &format!("{env_path}.{env_key}"))?;
                }
            }
        } else {
            check_finite(member, &format!("{path}.{key}"))?;
        }
    }
    Ok(())
}

/// `cfg.learned.entries` values are the source-sanitized bias surface; every other config number is finite.
fn check_config_finite(config: &SVal, path: &str) -> R<()> {
    let entries = object(config, path)?;
    for (key, member) in entries {
        if key == "learned" {
            let learned_path = format!("{path}.learned");
            let learned = object(member, &learned_path)?;
            for (learned_key, learned_member) in learned {
                if learned_key == "entries" {
                    let learned_path = format!("{learned_path}.entries");
                    let SVal::Arr(pairs) = learned_member else {
                        return Err(err(&learned_path, "learned entries must be an array"));
                    };
                    for (index, pair) in pairs.iter().enumerate() {
                        let pair_path = format!("{learned_path}[{index}]");
                        let SVal::Arr(values) = pair else {
                            return Err(err(
                                &pair_path,
                                "learned entry must be a [key,value] pair",
                            ));
                        };
                        if values.len() != 2 {
                            return Err(err(
                                &pair_path,
                                "learned entry must be a [key,value] pair",
                            ));
                        }
                        if !matches!(values[0], SVal::Str(_)) {
                            return Err(err(
                                &format!("{pair_path}[0]"),
                                "learned key must be a string",
                            ));
                        }
                        if !matches!(values[1], SVal::Num(_)) {
                            return Err(err(
                                &format!("{pair_path}[1]"),
                                "learned value must be a number",
                            ));
                        }
                    }
                } else {
                    check_finite(learned_member, &format!("{learned_path}.{learned_key}"))?;
                }
            }
        } else {
            check_finite(member, &format!("{path}.{key}"))?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------------
// Tier/persona/features.

fn parse_ex_gaussian(value: &SVal, path: &str) -> R<ExGaussian> {
    closed(value, &["mu", "sigma", "tau", "floor", "cap"], path)?;
    Ok(ExGaussian {
        mu: finite_number(value, "mu", path)?,
        sigma: finite_number(value, "sigma", path)?,
        tau: finite_number(value, "tau", path)?,
        floor: finite_number(value, "floor", path)?,
        cap: finite_number(value, "cap", path)?,
    })
}

fn parse_tier(values: &SVal, path: &str) -> R<TierParams> {
    closed(
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
        path,
    )?;
    let id = enum_field(values, "id", &["easy", "normal", "hard"], path)?;
    let mut tier = match id.as_str() {
        "easy" => TIERS[0],
        "normal" => TIERS[1],
        _ => TIERS[2],
    };
    tier.reaction = parse_ex_gaussian(
        field(values, "reaction", path)?,
        &format!("{path}.reaction"),
    )?;
    tier.step = parse_ex_gaussian(field(values, "step", path)?, &format!("{path}.step"))?;
    tier.daze = parse_ex_gaussian(field(values, "daze", path)?, &format!("{path}.daze"))?;
    tier.refractory_ms = finite_number(values, "refractoryMs", path)?;
    let think = field(values, "thinkMs", path)?;
    closed(think, &["mean", "jitter"], &format!("{path}.thinkMs"))?;
    tier.think_ms = Cadence {
        mean: finite_number(think, "mean", &format!("{path}.thinkMs"))?,
        jitter: finite_number(think, "jitter", &format!("{path}.thinkMs"))?,
    };
    let strategy = field(values, "strategyMs", path)?;
    closed(strategy, &["mean", "jitter"], &format!("{path}.strategyMs"))?;
    tier.strategy_ms = Cadence {
        mean: finite_number(strategy, "mean", &format!("{path}.strategyMs"))?,
        jitter: finite_number(strategy, "jitter", &format!("{path}.strategyMs"))?,
    };
    tier.apm = finite_number(values, "apm", path)?;
    tier.burst = finite_number(values, "burst", path)?;
    tier.min_gap_ms = finite_number(values, "minGapMs", path)?;
    let scatter = field(values, "moveScatter", path)?;
    closed(
        scatter,
        &["base", "perUnit"],
        &format!("{path}.moveScatter"),
    )?;
    tier.move_scatter = MoveScatter {
        base: finite_number(scatter, "base", &format!("{path}.moveScatter"))?,
        per_unit: finite_number(scatter, "perUnit", &format!("{path}.moveScatter"))?,
    };
    let target_scatter = field(values, "targetScatter", path)?;
    closed(
        target_scatter,
        &["sigma", "lagS", "slipP", "slipMult"],
        &format!("{path}.targetScatter"),
    )?;
    tier.target_scatter = TargetScatter {
        sigma: finite_number(target_scatter, "sigma", &format!("{path}.targetScatter"))?,
        lag_s: finite_number(target_scatter, "lagS", &format!("{path}.targetScatter"))?,
        slip_p: finite_number(target_scatter, "slipP", &format!("{path}.targetScatter"))?,
        slip_mult: finite_number(target_scatter, "slipMult", &format!("{path}.targetScatter"))?,
    };
    tier.minimap_sigma = finite_number(values, "minimapSigma", path)?;
    tier.edge_click_p = finite_number(values, "edgeClickP", path)?;
    tier.timing_sigma_ms = finite_number(values, "timingSigmaMs", path)?;
    let hesitation = field(values, "hesitation", path)?;
    closed(
        hesitation,
        &["p", "minMs", "maxMs"],
        &format!("{path}.hesitation"),
    )?;
    tier.hesitation = Hesitation {
        p: finite_number(hesitation, "p", &format!("{path}.hesitation"))?,
        min_ms: finite_number(hesitation, "minMs", &format!("{path}.hesitation"))?,
        max_ms: finite_number(hesitation, "maxMs", &format!("{path}.hesitation"))?,
    };
    tier.softmax_t = finite_number(values, "softmaxT", path)?;
    tier.lapse_p = finite_number(values, "lapseP", path)?;
    tier.dodge_p = finite_number(values, "dodgeP", path)?;
    tier.juke_p = finite_number(values, "jukeP", path)?;
    let orbwalk = field(values, "orbwalk", path)?;
    closed(
        orbwalk,
        &["p", "stepU", "angleJitter"],
        &format!("{path}.orbwalk"),
    )?;
    tier.orbwalk = Orbwalk {
        p: finite_number(orbwalk, "p", &format!("{path}.orbwalk"))?,
        step_u: finite_number(orbwalk, "stepU", &format!("{path}.orbwalk"))?,
        angle_jitter: finite_number(orbwalk, "angleJitter", &format!("{path}.orbwalk"))?,
    };
    tier.knowledge = finite_number(values, "knowledge", path)?;
    tier.mob_share_noise = finite_number(values, "mobShareNoise", path)?;
    let route = field(values, "route", path)?;
    closed(
        route,
        &["horizon", "walkPaths", "reach"],
        &format!("{path}.route"),
    )?;
    tier.route = Route {
        horizon: uint_field(
            route,
            "horizon",
            u64::from(u32::MAX),
            &format!("{path}.route"),
        )? as u32,
        walk_paths: bool_field(route, "walkPaths", &format!("{path}.route"))?,
        reach: finite_number(route, "reach", &format!("{path}.route"))?,
    };
    let attention = field(values, "attention", path)?;
    closed(
        attention,
        &["central", "peripheryMult", "engagedMult", "reconsiderMs"],
        &format!("{path}.attention"),
    )?;
    tier.attention = Attention {
        central: finite_number(attention, "central", &format!("{path}.attention"))?,
        periphery_mult: finite_number(attention, "peripheryMult", &format!("{path}.attention"))?,
        engaged_mult: finite_number(attention, "engagedMult", &format!("{path}.attention"))?,
        reconsider_ms: finite_number(attention, "reconsiderMs", &format!("{path}.attention"))?,
    };
    tier.memory_span_ms = finite_number(values, "memorySpanMs", path)?;
    tier.feint_read = finite_number(values, "feintRead", path)?;
    let appraisal = field(values, "appraisal", path)?;
    closed(
        appraisal,
        &["bias", "lead", "busy", "hue", "noise"],
        &format!("{path}.appraisal"),
    )?;
    tier.appraisal = Appraisal {
        bias: finite_number(appraisal, "bias", &format!("{path}.appraisal"))?,
        lead: finite_number(appraisal, "lead", &format!("{path}.appraisal"))?,
        busy: finite_number(appraisal, "busy", &format!("{path}.appraisal"))?,
        hue: finite_number(appraisal, "hue", &format!("{path}.appraisal"))?,
        noise: finite_number(appraisal, "noise", &format!("{path}.appraisal"))?,
    };
    tier.wary = finite_number(values, "wary", path)?;
    let caution = field(values, "caution", path)?;
    closed(
        caution,
        &["mobShare", "eliteShare", "startHp"],
        &format!("{path}.caution"),
    )?;
    tier.caution = Caution {
        mob_share: finite_number(caution, "mobShare", &format!("{path}.caution"))?,
        elite_share: finite_number(caution, "eliteShare", &format!("{path}.caution"))?,
        start_hp: finite_number(caution, "startHp", &format!("{path}.caution"))?,
    };
    Ok(tier)
}

fn parse_persona(values: &SVal, path: &str) -> R<PersonaParams> {
    closed(
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
        path,
    )?;
    let id = enum_field(
        values,
        "id",
        &["farmer", "hunter", "opportunist", "cautious"],
        path,
    )?;
    let mut persona = match id.as_str() {
        "farmer" => PERSONAS[0],
        "hunter" => PERSONAS[1],
        "opportunist" => PERSONAS[2],
        _ => PERSONAS[3],
    };
    persona.pve = finite_number(values, "pve", path)?;
    persona.pvp = finite_number(values, "pvp", path)?;
    persona.loot = finite_number(values, "loot", path)?;
    persona.bounty = finite_number(values, "bounty", path)?;
    persona.third_party = finite_number(values, "thirdParty", path)?;
    persona.engage_edge = finite_number(values, "engageEdge", path)?;
    persona.bounty_caution = finite_number(values, "bountyCaution", path)?;
    persona.flee_hp = finite_number(values, "fleeHp", path)?;
    persona.reengage_hp = finite_number(values, "reengageHp", path)?;
    persona.kite = finite_number(values, "kite", path)?;
    persona.chase_give_up_ms = finite_number(values, "chaseGiveUpMs", path)?;
    persona.mob_kill_goal = finite_number(values, "mobKillGoal", path)?;
    persona.player_threat = finite_number(values, "playerThreat", path)?;
    persona.elite_appetite = finite_number(values, "eliteAppetite", path)?;
    persona.coliseum = finite_number(values, "coliseum", path)?;
    persona.risk = finite_number(values, "risk", path)?;
    Ok(persona)
}

fn parse_features(value: &SVal, path: &str) -> R<Features> {
    closed(
        value,
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
        path,
    )?;
    let mut message_types = Vec::new();
    for (index, message) in array_field(value, "messageTypes", path)?.iter().enumerate() {
        let message = match message {
            SVal::Str(message) => message.clone(),
            other => {
                return Err(err(
                    &format!("{path}.messageTypes[{index}]"),
                    format!("expected a string, got {}", kind_of(other)),
                ))
            }
        };
        one_of(
            &message,
            &FEATURES_MESSAGES,
            &format!("{path}.messageTypes[{index}]"),
        )?;
        message_types.push(message);
    }
    Ok(Features {
        message_types,
        wishes: bool_field(value, "wishes", path)?,
        status_effects: bool_field(value, "statusEffects", path)?,
        fields: bool_field(value, "fields", path)?,
        planning: bool_field(value, "planning", path)?,
        chests: bool_field(value, "chests", path)?,
        skills: bool_field(value, "skills", path)?,
        relics: bool_field(value, "relics", path)?,
        camps: bool_field(value, "camps", path)?,
        hazards: bool_field(value, "hazards", path)?,
    })
}

// ---------------------------------------------------------------------------------------------------------------------
// Declared descriptors shared by configs/declarations.

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum PathDescriptor {
    RadiusDenial { radius: f64 },
    HalfPlane { x: f64 },
}

pub(crate) fn parse_path_descriptor(value: &SVal, path: &str) -> R<PathDescriptor> {
    let kind = string_field(value, "kind", path)?;
    match kind.as_str() {
        "radius-denial" => {
            closed(value, &["kind", "radius"], path)?;
            Ok(PathDescriptor::RadiusDenial {
                radius: finite_number(value, "radius", path)?,
            })
        }
        "half-plane" => {
            closed(value, &["kind", "x"], path)?;
            Ok(PathDescriptor::HalfPlane {
                x: finite_number(value, "x", path)?,
            })
        }
        other => Err(err(
            &format!("{path}.kind"),
            format!("unsupported declared path descriptor {other}"),
        )),
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum WalkDescriptor {
    Direct { factor: f64 },
    Real,
    RadiusDenial { radius: f64 },
}

fn parse_walk_descriptor(value: &SVal, path: &str) -> R<WalkDescriptor> {
    let kind = string_field(value, "kind", path)?;
    match kind.as_str() {
        "direct" => {
            closed(value, &["kind", "factor"], path)?;
            Ok(WalkDescriptor::Direct {
                factor: finite_number(value, "factor", path)?,
            })
        }
        "real" => {
            closed(value, &["kind"], path)?;
            Ok(WalkDescriptor::Real)
        }
        "radius-denial" => {
            closed(value, &["kind", "radius"], path)?;
            Ok(WalkDescriptor::RadiusDenial {
                radius: finite_number(value, "radius", path)?,
            })
        }
        other => Err(err(
            &format!("{path}.kind"),
            format!("unsupported declared walk descriptor {other}"),
        )),
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum SightDescriptor {
    Source,
    RadiusDenial { radius: f64 },
}

fn parse_sight_descriptor(value: &SVal, path: &str) -> R<SightDescriptor> {
    let kind = string_field(value, "kind", path)?;
    match kind.as_str() {
        "source" => {
            closed(value, &["kind"], path)?;
            Ok(SightDescriptor::Source)
        }
        "radius-denial" => {
            closed(value, &["kind", "radius"], path)?;
            Ok(SightDescriptor::RadiusDenial {
                radius: finite_number(value, "radius", path)?,
            })
        }
        other => Err(err(
            &format!("{path}.kind"),
            format!("unsupported declared sight descriptor {other}"),
        )),
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct EnvSpec {
    pub(crate) path: Option<PathDescriptor>,
    pub(crate) learned: Option<Vec<(String, f64)>>,
}

fn parse_env_spec(value: &SVal, path: &str) -> R<EnvSpec> {
    let entries = object(value, path)?;
    let mut env = EnvSpec {
        path: None,
        learned: None,
    };
    for (key, member) in entries {
        match key.as_str() {
            "path" => env.path = Some(parse_path_descriptor(member, &format!("{path}.path"))?),
            "learned" => {
                let learned_path = format!("{path}.learned");
                let SVal::Arr(pairs) = member else {
                    return Err(err(
                        &learned_path,
                        "env.learned must be an array of bias pairs",
                    ));
                };
                let mut learned = Vec::with_capacity(pairs.len());
                for (index, pair) in pairs.iter().enumerate() {
                    let pair_path = format!("{learned_path}[{index}]");
                    let SVal::Arr(values) = pair else {
                        return Err(err(
                            &pair_path,
                            "env.learned entry must be a [key,value] pair",
                        ));
                    };
                    if values.len() != 2 {
                        return Err(err(
                            &pair_path,
                            "env.learned entry must be a [key,value] pair",
                        ));
                    }
                    let key = match &values[0] {
                        SVal::Str(text) => text.clone(),
                        other => {
                            return Err(err(
                                &format!("{pair_path}[0]"),
                                format!(
                                    "learned bias key must be a string, got {}",
                                    kind_of(other)
                                ),
                            ))
                        }
                    };
                    let number = match &values[1] {
                        SVal::Num(number) => *number,
                        other => {
                            return Err(err(
                                &format!("{pair_path}[1]"),
                                format!(
                                    "learned bias value must be a number, got {}",
                                    kind_of(other)
                                ),
                            ))
                        }
                    };
                    learned.push((key, number));
                }
                env.learned = Some(learned);
            }
            other => return Err(err(path, format!("unsupported hook env override {other}"))),
        }
    }
    Ok(env)
}

// ---------------------------------------------------------------------------------------------------------------------
// Frozen corpus envelope, maps and catalog.

#[derive(Clone, Debug)]
pub(crate) struct Source {
    pub(crate) maps: Vec<MapFixture>,
    pub(crate) catalog: Catalog,
    pub(crate) cases: Vec<Case>,
}

impl Source {
    pub(crate) fn map_index(&self, label: &str) -> R<usize> {
        self.maps
            .iter()
            .position(|map| map.id == label)
            .ok_or_else(|| format!("source map label {label:?} is not declared in body.maps"))
    }

    pub(crate) fn map(&self, label: &str) -> R<&MapFixture> {
        self.map_index(label).map(|index| &self.maps[index])
    }
}

#[derive(Clone, Debug)]
pub(crate) struct MapFixture {
    pub(crate) id: String,
    pub(crate) map_hash_u32: u32,
    /// Collision map of the declared source `GameMap`; carries the admitted full layers when the map has them.
    pub(crate) open: TileMap,
    /// Source `withGates`: the same map with every `coliseum.gates[].tiles` tile set to `TILE_WALL`.
    pub(crate) locked: TileMap,
    pub(crate) plan: PlanMap,
    /// The complete decoded source `GameMap` metadata (terrain lives here for the hand-built arenas).
    pub(crate) data: GameMapData,
    /// Admitted full gameplay layers; `None` for a source hand-built `mapFromTiles` arena (see `fully_admitted`).
    pub(crate) layers: Option<std::sync::Arc<MapLayers>>,
    /// The stable decoded tagged source map value (`rh-method-value/1`) for callback-result replay.
    pub(crate) raw: SVal,
}

impl MapFixture {
    pub(crate) fn layers(&self) -> Option<&MapLayers> {
        self.layers.as_deref()
    }

    /// The declared source `GameMap.terrain` layer for all eight maps (modules never invent terrain from absent layers).
    pub(crate) fn terrain(&self) -> &[u8] {
        &self.data.terrain
    }

    /// Whether this map passed the complete strict `MapExport::validate` layer admission.
    pub(crate) fn fully_admitted(&self) -> bool {
        self.layers.is_some()
    }

    /// Source `campGeoms` (memory.ts): the declared camps, else the regions' mob camps, exactly as the admitted
    /// Memory reader derives them.
    pub(crate) fn memory_camps(&self) -> R<Vec<CampGeom>> {
        let mut camps: Vec<CampGeom> = Vec::new();
        if !self.data.camps.is_empty() {
            for camp in &self.data.camps {
                camps.push(CampGeom {
                    id: camp.id.clone(),
                    zone: faction_from_zone(camp.zone)?,
                    elite: camp.elite_spot >= 0,
                    x: camp.x,
                    y: camp.y,
                    radius: if camp.radius > 0. {
                        camp.radius
                    } else {
                        camp.r
                    },
                    spots: camp
                        .spots
                        .iter()
                        .map(|spot| Vec2::new(spot.x, spot.y))
                        .collect(),
                });
            }
            return Ok(camps);
        }
        for region in &self.data.regions {
            for camp in &region.mob_camps {
                camps.push(CampGeom {
                    id: camp.id.clone(),
                    zone: faction_from_zone(camp.region)?,
                    elite: camp.elite,
                    x: camp.x,
                    y: camp.y,
                    radius: rh_sim::constants::MOB_LEASH_RADIUS,
                    spots: camp
                        .spots
                        .iter()
                        .map(|spot| Vec2::new(spot.x, spot.y))
                        .collect(),
                });
            }
        }
        Ok(camps)
    }
}

fn faction_from_zone(zone: rh_sim::mapdata::Zone) -> R<FactionId> {
    FactionId::parse(zone.as_str()).ok_or_else(|| format!("unknown map zone {}", zone.as_str()))
}

#[derive(Clone, Debug)]
pub(crate) struct Catalog {
    /// The complete decoded source catalog, read-only.
    pub(crate) raw: SVal,
    pub(crate) cards: SVal,
    pub(crate) card_ids: Vec<String>,
    pub(crate) abilities: SVal,
    pub(crate) ability_ids: Vec<String>,
    pub(crate) chest_boost_stats: Vec<String>,
    pub(crate) kill_stat_keys: Vec<String>,
    pub(crate) rules: SVal,
}

impl Catalog {
    /// The 80 declared card records, in source catalog order.
    pub(crate) fn card_rows(&self) -> &[SVal] {
        match &self.cards {
            SVal::Arr(rows) => rows,
            _ => &[],
        }
    }
}

fn catalog_strings(value: &SVal, path: &str) -> R<Vec<String>> {
    let SVal::Arr(rows) = value else {
        return Err(err(path, "expected an array of strings"));
    };
    rows.iter()
        .enumerate()
        .map(|(index, row)| match row {
            SVal::Str(text) => Ok(text.clone()),
            other => Err(err(
                &format!("{path}[{index}]"),
                format!("expected a string, got {}", kind_of(other)),
            )),
        })
        .collect()
}

fn parse_catalog(value: &Value, path: &str) -> R<Catalog> {
    let decoded = decode_input(value, path)?;
    closed(
        &decoded,
        &[
            "cards",
            "cardIds",
            "abilities",
            "abilityIds",
            "chestBoostStats",
            "killStatKeys",
            "rules",
        ],
        path,
    )?;
    let cards = field(&decoded, "cards", path)?.clone();
    let SVal::Arr(card_rows) = &cards else {
        return Err(err(&format!("{path}.cards"), "expected the 80-card array"));
    };
    if card_rows.len() != 80 {
        return Err(err(
            &format!("{path}.cards"),
            format!(
                "the source catalog declares 80 cards, got {}",
                card_rows.len()
            ),
        ));
    }
    let card_ids = catalog_strings(
        field(&decoded, "cardIds", path)?,
        &format!("{path}.cardIds"),
    )?;
    if card_ids.len() != 80 {
        return Err(err(
            &format!("{path}.cardIds"),
            format!("expected 80 card ids, got {}", card_ids.len()),
        ));
    }
    let abilities = field(&decoded, "abilities", path)?.clone();
    match &abilities {
        SVal::Obj(rows) => {
            if rows.len() != 5 {
                return Err(err(
                    &format!("{path}.abilities"),
                    format!(
                        "the source catalog declares exactly 5 Wish defs, got {}",
                        rows.len()
                    ),
                ));
            }
        }
        other => {
            return Err(err(
                &format!("{path}.abilities"),
                format!("expected the Wish def map, got {}", kind_of(other)),
            ))
        }
    }
    let ability_ids = catalog_strings(
        field(&decoded, "abilityIds", path)?,
        &format!("{path}.abilityIds"),
    )?;
    if ability_ids.len() != 5 {
        return Err(err(
            &format!("{path}.abilityIds"),
            format!("expected 5 ability ids, got {}", ability_ids.len()),
        ));
    }
    let chest_boost_stats = catalog_strings(
        field(&decoded, "chestBoostStats", path)?,
        &format!("{path}.chestBoostStats"),
    )?;
    let kill_stat_keys = catalog_strings(
        field(&decoded, "killStatKeys", path)?,
        &format!("{path}.killStatKeys"),
    )?;
    let rules = field(&decoded, "rules", path)?.clone();
    if !matches!(rules, SVal::Obj(_)) {
        return Err(err(
            &format!("{path}.rules"),
            "expected the source rule table map",
        ));
    }
    Ok(Catalog {
        raw: decoded,
        cards,
        card_ids,
        abilities,
        ability_ids,
        chest_boost_stats,
        kill_stat_keys,
        rules,
    })
}

fn source_hand_map(data: &GameMapData) -> bool {
    let zero_grid = |grid: &[u8]| grid.iter().all(|value| *value == 0);
    data.coliseum.rect.w == 0
        && data.coliseum.rect.h == 0
        && data.coliseum.rect.x == 0
        && data.coliseum.rect.y == 0
        && data.coliseum.gates.is_empty()
        && data.coliseum.inner_spawns.is_empty()
        && data.regions.is_empty()
        && data.camps.is_empty()
        && data.spawn_pool.is_empty()
        && data.buildings.is_empty()
        && data.spawns.is_empty()
        && data.crate_spots.is_empty()
        && data.ground_spots.is_empty()
        && data.features.is_empty()
        && data.props.is_empty()
        && data.attempt == 0
        && zero_grid(&data.region_grid)
        && zero_grid(&data.territory_grid)
        && zero_grid(&data.feature_grid)
}

fn parse_map_fixture(raw: &Value, path: &str) -> R<MapFixture> {
    let map_value = raw
        .as_object()
        .ok_or_else(|| err(path, "map fixture must be a JSON object"))?;
    for key in map_value.keys() {
        if !["id", "mapHashU32", "value"].contains(&key.as_str()) {
            return Err(err(path, format!("unsupported map fixture field {key}")));
        }
    }
    for key in ["id", "mapHashU32", "value"] {
        if !map_value.contains_key(key) {
            return Err(err(path, format!("missing map fixture field {key}")));
        }
    }
    let id = raw["id"]
        .as_str()
        .filter(|id| !id.is_empty())
        .ok_or_else(|| err(&format!("{path}.id"), "expected a non-empty map id"))?
        .to_string();
    let declared_hash = raw["mapHashU32"]
        .as_u64()
        .filter(|hash| *hash <= u64::from(u32::MAX))
        .ok_or_else(|| {
            err(
                &format!("{path}.mapHashU32"),
                "expected the uint32 source map hash",
            )
        })? as u32;
    let value_path = format!("{path}.value");
    let tagged = decode_input(&raw["value"], &value_path)?;
    if !matches!(tagged, SVal::Obj(_)) {
        return Err(err(
            &value_path,
            "expected the tagged source GameMap object",
        ));
    }
    let plain = sval_to_json(&tagged, &value_path)?;
    let data: GameMapData = serde_json::from_value(plain).map_err(|error| {
        err(
            &value_path,
            format!("embedded source GameMap does not match the admitted map DTO: {error}"),
        )
    })?;
    let recomputed = map_hash(&data);
    let recomputed_u32 = u32::from_str_radix(&recomputed, 16)
        .map_err(|error| err(&value_path, format!("map hash is not hex: {error}")))?;
    if recomputed_u32 != declared_hash {
        return Err(err(
            &format!("{path}.mapHashU32"),
            format!(
                "embedded map hash {declared_hash} does not match the recomputed source hash {recomputed} ({recomputed_u32})"
            ),
        ));
    }
    let export = MapExport {
        format: MAP_EXPORT_FORMAT.into(),
        legacy_map_hash_u32: declared_hash,
        map: data.clone(),
    };
    let (open, locked, layers) = match export.validate() {
        Ok(validated) => {
            let (width, height, tiles, layers) = validated.into_parts();
            let layers = std::sync::Arc::new(layers);
            let mut locked_tiles = tiles.clone();
            for gate in &data.coliseum.gates {
                for tile in &gate.tiles {
                    if tile.x < 0 || tile.y < 0 {
                        return Err(err(&value_path, "gate tile must lie inside the map grid"));
                    }
                    let index = tile.y as usize * width as usize + tile.x as usize;
                    let Some(slot) = locked_tiles.get_mut(index) else {
                        return Err(err(&value_path, "gate tile must lie inside the map grid"));
                    };
                    *slot = rh_sim::map::TILE_WALL;
                }
            }
            let open = TileMap::new(width, height, tiles)
                .map_err(|error| err(&value_path, format!("collision map: {error}")))?
                .with_layers(layers.clone())
                .map_err(|error| err(&value_path, format!("map layers: {error}")))?;
            // Source `withGates` shares the same metadata object; the admitted collision gate cannot re-attach those
            // layers to the walled tile grid (the canonical gate tiles must stay open floor there), so the locked
            // collision map is admitted layer-less. Its gameplay metadata is still reachable through `open`/`layers`.
            let locked = TileMap::new(width, height, locked_tiles)
                .map_err(|error| err(&value_path, format!("locked collision map: {error}")))?;
            (open, locked, Some(layers))
        }
        Err(error) => {
            if !source_hand_map(&data) {
                return Err(err(
                    &value_path,
                    format!(
                        "source map {id} is neither fully admissible nor a source hand-built mapFromTiles arena: {error}"
                    ),
                ));
            }
            let open = TileMap::new(data.w, data.h, data.tiles.clone())
                .map_err(|error| err(&value_path, format!("collision map: {error}")))?;
            let mut locked_tiles = data.tiles.clone();
            for gate in &data.coliseum.gates {
                for tile in &gate.tiles {
                    if tile.x < 0 || tile.y < 0 {
                        continue;
                    }
                    let index = tile.y as usize * data.w as usize + tile.x as usize;
                    if let Some(slot) = locked_tiles.get_mut(index) {
                        *slot = rh_sim::map::TILE_WALL;
                    }
                }
            }
            let locked = TileMap::new(data.w, data.h, locked_tiles)
                .map_err(|error| err(&value_path, format!("locked collision map: {error}")))?;
            (open, locked, None)
        }
    };
    let plan = PlanMap {
        camps: data
            .camps
            .iter()
            .map(|camp| PlanCamp {
                id: camp.id.clone(),
                zone: camp.zone,
                x: camp.x,
                y: camp.y,
                elite_spot: camp.elite_spot,
            })
            .collect(),
        spawn_pool: data
            .spawn_pool
            .iter()
            .map(|spawn| PlanSpawn {
                x: spawn.x,
                y: spawn.y,
                zone: spawn.zone,
            })
            .collect(),
    };
    Ok(MapFixture {
        id,
        map_hash_u32: declared_hash,
        open,
        locked,
        plan,
        data,
        layers,
        raw: tagged,
    })
}

// ---------------------------------------------------------------------------------------------------------------------
// Configs.

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct InitialFrame {
    pub(crate) now: f64,
    pub(crate) gates_locked: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Services {
    pub(crate) kind: String,
    pub(crate) path_descriptor: Option<PathDescriptor>,
    pub(crate) log: String,
    pub(crate) initial_frame: InitialFrame,
    pub(crate) budget_lifecycle: String,
    pub(crate) frame_lifecycle: String,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct LearnedConfig {
    pub(crate) enabled: bool,
    /// Argument-sensitive declared bias entries; nonfinite values are the source-sanitized exception.
    pub(crate) entries: Vec<(String, f64)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct RngSeeds {
    pub(crate) decide: u32,
    pub(crate) motor: u32,
    pub(crate) lapse: u32,
    pub(crate) knowledge: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct SourceConfig {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) modules: Vec<String>,
    pub(crate) services: Services,
    pub(crate) learned: LearnedConfig,
    pub(crate) seed: u32,
    pub(crate) tier: TierParams,
    pub(crate) persona: PersonaParams,
    pub(crate) map: String,
    pub(crate) map_index: usize,
    pub(crate) features: Features,
    pub(crate) path_budget: u32,
    pub(crate) path: Option<PathDescriptor>,
    pub(crate) seeds: RngSeeds,
}

impl SourceConfig {
    /// The admitted static tier row by id (`MemoryConfig` holds a `&'static TierParams`).
    pub(crate) fn tier_static(&self) -> &'static TierParams {
        TierParams::by_id(self.tier.id)
    }

    /// The resolved declared source map for this cfg (its label is a foreign key into `Source.maps`).
    pub(crate) fn map_fixture<'a>(&self, source: &'a Source) -> R<&'a MapFixture> {
        source.maps.get(self.map_index).ok_or_else(|| {
            format!(
                "cfg {}: declared map index {} is outside source.maps",
                self.id, self.map_index
            )
        })
    }

    /// The admitted private Memory config for this declared cfg on the declared source map.
    pub(crate) fn memory_config(&self, map: &MapFixture) -> R<MemoryConfig> {
        Ok(MemoryConfig {
            self_id: self.id.clone(),
            tier: self.tier_static(),
            map: MemoryMap {
                camps: map.memory_camps()?,
            },
            features: self.features.clone(),
        })
    }
}

fn parse_learned(value: &SVal, path: &str) -> R<LearnedConfig> {
    closed(value, &["kind", "enabled", "entries"], path)?;
    if string_field(value, "kind", path)? != "argument-sensitive-lookup" {
        return Err(err(
            &format!("{path}.kind"),
            "the source learned snapshot is argument-sensitive-lookup",
        ));
    }
    let enabled = bool_field(value, "enabled", path)?;
    let mut entries = Vec::new();
    for (index, pair) in array_field(value, "entries", path)?.iter().enumerate() {
        let pair_path = format!("{path}.entries[{index}]");
        let SVal::Arr(values) = pair else {
            return Err(err(&pair_path, "learned entry must be a [key,value] pair"));
        };
        if values.len() != 2 {
            return Err(err(&pair_path, "learned entry must be a [key,value] pair"));
        }
        let key = match &values[0] {
            SVal::Str(text) => text.clone(),
            other => {
                return Err(err(
                    &format!("{pair_path}[0]"),
                    format!("learned key must be a string, got {}", kind_of(other)),
                ))
            }
        };
        let number = match &values[1] {
            SVal::Num(number) => *number,
            other => {
                return Err(err(
                    &format!("{pair_path}[1]"),
                    format!("learned value must be a number, got {}", kind_of(other)),
                ))
            }
        };
        entries.push((key, number));
    }
    Ok(LearnedConfig { enabled, entries })
}

fn parse_services(value: &SVal, path: &str) -> R<Services> {
    closed(
        value,
        &[
            "kind",
            "pathDescriptor",
            "log",
            "initialFrame",
            "budgetLifecycle",
            "frameLifecycle",
        ],
        path,
    )?;
    let kind = string_field(value, "kind", path)?;
    if kind != "real-path-service" {
        return Err(err(
            &format!("{path}.kind"),
            format!("unsupported declared service {kind}"),
        ));
    }
    let path_descriptor = match field(value, "pathDescriptor", path)? {
        SVal::Null => None,
        descriptor => Some(parse_path_descriptor(
            descriptor,
            &format!("{path}.pathDescriptor"),
        )?),
    };
    let log = string_field(value, "log", path)?;
    if log != "record" {
        return Err(err(
            &format!("{path}.log"),
            format!("unsupported declared log sink {log}"),
        ));
    }
    let frame = field(value, "initialFrame", path)?;
    closed(
        frame,
        &["now", "gatesLocked"],
        &format!("{path}.initialFrame"),
    )?;
    let initial_frame = InitialFrame {
        now: finite_number(frame, "now", &format!("{path}.initialFrame"))?,
        gates_locked: bool_field(frame, "gatesLocked", &format!("{path}.initialFrame"))?,
    };
    Ok(Services {
        kind,
        path_descriptor,
        log,
        initial_frame,
        budget_lifecycle: string_field(value, "budgetLifecycle", path)?,
        frame_lifecycle: string_field(value, "frameLifecycle", path)?,
    })
}

fn parse_rng_seeds(value: &SVal, path: &str) -> R<RngSeeds> {
    closed(value, &["decide", "motor", "lapse", "knowledge"], path)?;
    Ok(RngSeeds {
        decide: uint_field(value, "decide", u64::from(u32::MAX), path)? as u32,
        motor: uint_field(value, "motor", u64::from(u32::MAX), path)? as u32,
        lapse: uint_field(value, "lapse", u64::from(u32::MAX), path)? as u32,
        knowledge: uint_field(value, "knowledge", u64::from(u32::MAX), path)? as u32,
    })
}

/// `tierOverrides`/`personaOverrides` are already merged into the declared `tierValues`/`personaValues`; the reader only
/// insists they are finite objects when declared, so a mutated raw body cannot smuggle geometry through them.
fn check_declared_overrides(value: &SVal, path: &str) -> R<()> {
    let entries = object(value, path)?;
    for (key, member) in entries {
        match member {
            SVal::Num(number) if number.is_finite() => {}
            SVal::Obj(nested) => {
                let nested_path = format!("{path}.{key}");
                object(member, &nested_path)?;
                for (name, leaf) in nested {
                    match leaf {
                        SVal::Num(number) if number.is_finite() => {}
                        other => {
                            return Err(err(
                                &format!("{nested_path}.{name}"),
                                format!("override must be a finite number, got {}", kind_of(other)),
                            ))
                        }
                    }
                }
            }
            other => {
                return Err(err(
                    &format!("{path}.{key}"),
                    format!("override must be a finite number, got {}", kind_of(other)),
                ))
            }
        }
    }
    Ok(())
}

fn parse_config(value: &SVal, token: &str, maps: &[MapFixture], path: &str) -> R<SourceConfig> {
    allowed_keys(
        value,
        &[
            "id",
            "name",
            "modules",
            "services",
            "learned",
            "seed",
            "tier",
            "persona",
            "map",
            "features",
            "pathBudget",
            "tierValues",
            "personaValues",
            "seeds",
            "tierOverrides",
            "personaOverrides",
            "path",
        ],
        path,
    )?;
    require_fields(
        value,
        &[
            "id",
            "name",
            "modules",
            "services",
            "learned",
            "seed",
            "tier",
            "persona",
            "map",
            "features",
            "pathBudget",
            "tierValues",
            "personaValues",
            "seeds",
        ],
        path,
    )?;
    let id = string_field(value, "id", path)?;
    if id.is_empty() {
        return Err(err(
            &format!("{path}.id"),
            "declared cfg id must be non-empty",
        ));
    }
    let name = string_field(value, "name", path)?;
    let modules = string_array(value, "modules", path)?;
    if modules != ["wishes", "planning", "chests", "hazards"] {
        return Err(err(
            &format!("{path}.modules"),
            format!("declared cfg modules must be the four ordered built-ins, got {modules:?}"),
        ));
    }
    let services = parse_services(field(value, "services", path)?, &format!("{path}.services"))?;
    let learned = parse_learned(field(value, "learned", path)?, &format!("{path}.learned"))?;
    let seed = uint_field(value, "seed", u64::from(u32::MAX), path)? as u32;
    let tier_label = enum_field(value, "tier", &["easy", "normal", "hard"], path)?;
    let persona_label = enum_field(
        value,
        "persona",
        &["farmer", "hunter", "opportunist", "cautious"],
        path,
    )?;
    let map_label = string_field(value, "map", path)?;
    let map_index = maps
        .iter()
        .position(|map| map.id == map_label)
        .ok_or_else(|| {
            err(
                &format!("{path}.map"),
                format!("missing source map label {map_label:?} in body.maps"),
            )
        })?;
    let features = parse_features(field(value, "features", path)?, &format!("{path}.features"))?;
    let path_budget = uint_field(value, "pathBudget", u64::from(u32::MAX), path)? as u32;
    let tier = parse_tier(
        field(value, "tierValues", path)?,
        &format!("{path}.tierValues"),
    )?;
    if tier.id.as_str() != tier_label {
        return Err(err(
            &format!("{path}.tier"),
            format!(
                "declared tier label {tier_label} differs from tierValues.id {}",
                tier.id.as_str()
            ),
        ));
    }
    let persona = parse_persona(
        field(value, "personaValues", path)?,
        &format!("{path}.personaValues"),
    )?;
    if persona.id.as_str() != persona_label {
        return Err(err(
            &format!("{path}.persona"),
            format!(
                "declared persona label {persona_label} differs from personaValues.id {}",
                persona.id.as_str()
            ),
        ));
    }
    let seeds = parse_rng_seeds(field(value, "seeds", path)?, &format!("{path}.seeds"))?;
    let expected_decide = seed;
    let expected_motor = seed.wrapping_add(1);
    let expected_lapse = seed.wrapping_add(2);
    let expected_knowledge = seed.wrapping_add(3);
    if seeds.decide != expected_decide
        || seeds.motor != expected_motor
        || seeds.lapse != expected_lapse
        || seeds.knowledge != expected_knowledge
    {
        return Err(err(
            &format!("{path}.seeds"),
            format!(
                "declared lanes must be seed/seed+1/seed+2/seed+3 for seed {seed}, got {}/{}/{}/{}",
                seeds.decide, seeds.motor, seeds.lapse, seeds.knowledge
            ),
        ));
    }
    let declared_path = match optional(value, "path") {
        None => None,
        Some(SVal::Null) | Some(SVal::Undefined) => None,
        Some(descriptor) => Some(parse_path_descriptor(descriptor, &format!("{path}.path"))?),
    };
    if let (Some(descriptor), Some(services_descriptor)) =
        (declared_path.as_ref(), services.path_descriptor.as_ref())
    {
        let matches = match (descriptor, services_descriptor) {
            (
                PathDescriptor::RadiusDenial { radius: declared },
                PathDescriptor::RadiusDenial { radius: service },
            ) => declared == service,
            (
                PathDescriptor::HalfPlane { x: declared },
                PathDescriptor::HalfPlane { x: service },
            ) => declared == service,
            _ => false,
        };
        if !matches {
            return Err(err(
                &format!("{path}.path"),
                "declared cfg path differs from the resolved service pathDescriptor",
            ));
        }
    } else if declared_path.is_some() != services.path_descriptor.is_some() {
        return Err(err(
            &format!("{path}.path"),
            "declared cfg path and services.pathDescriptor disagree on presence",
        ));
    }
    if let Some(overrides) = optional(value, "tierOverrides") {
        check_declared_overrides(overrides, &format!("{path}.tierOverrides"))?;
    }
    if let Some(overrides) = optional(value, "personaOverrides") {
        check_declared_overrides(overrides, &format!("{path}.personaOverrides"))?;
    }
    let _ = token;
    Ok(SourceConfig {
        id,
        name,
        modules,
        services,
        learned,
        seed,
        tier,
        persona,
        map: map_label,
        map_index,
        features,
        path_budget,
        path: declared_path,
        seeds,
    })
}

// ---------------------------------------------------------------------------------------------------------------------
// Declared percept -> private module percept + admitted Memory percept.

fn ai_tag(text: &str, path: &str) -> R<crate::bots::wish::AiIntent> {
    use crate::bots::wish::AiIntent;
    Ok(match text {
        "escape" => AiIntent::Escape,
        "sustain" => AiIntent::Sustain,
        "engage" => AiIntent::Engage,
        "control" => AiIntent::Control,
        "peel" => AiIntent::Peel,
        "burst" => AiIntent::Burst,
        "zone" => AiIntent::Zone,
        "buff" => AiIntent::Buff,
        other => {
            return Err(err(
                path,
                format!("unsupported source AiIntent tag {other}"),
            ))
        }
    })
}

fn blocked_by_tag(text: &str, path: &str) -> R<crate::bots::wish::BlockedBy> {
    use crate::bots::wish::BlockedBy;
    Ok(match text {
        "stun" => BlockedBy::Stun,
        "silence" => BlockedBy::Silence,
        "root" => BlockedBy::Root,
        other => {
            return Err(err(
                path,
                format!("unsupported source blockedBy tag {other}"),
            ))
        }
    })
}

fn parse_targeting(value: &SVal, path: &str) -> R<WishTargeting> {
    let kind = string_field(value, "kind", path)?;
    match kind.as_str() {
        "self" => {
            closed(value, &["kind"], path)?;
            Ok(WishTargeting::Self_)
        }
        "dir" => {
            closed(value, &["kind"], path)?;
            Ok(WishTargeting::Dir)
        }
        "unit" => {
            closed(value, &["kind", "range", "los", "snapRadius", "who"], path)?;
            let who = string_field(value, "who", path)?;
            if who != "enemy" {
                return Err(err(
                    &format!("{path}.who"),
                    format!("unsupported unit target {who}"),
                ));
            }
            Ok(WishTargeting::Unit {
                range: finite_number(value, "range", path)?,
                los: bool_field(value, "los", path)?,
                snap_radius: finite_number(value, "snapRadius", path)?,
            })
        }
        "point" => {
            closed(value, &["kind", "range", "minRange"], path)?;
            Ok(WishTargeting::Point {
                range: finite_number(value, "range", path)?,
                min_range: finite_number(value, "minRange", path)?,
            })
        }
        other => Err(err(
            &format!("{path}.kind"),
            format!("unsupported source targeting kind {other}"),
        )),
    }
}

fn parse_ability_rank(value: &SVal, path: &str) -> R<AbilityRank> {
    object(value, path)?;
    let raw = method_value(value, path)?;
    let cast_ms = match optional(value, "castMs") {
        None => None,
        Some(member) => Some(finite_number_value(member, &format!("{path}.castMs"))?),
    };
    let targeting = match optional(value, "targeting") {
        None => None,
        Some(member) => Some(parse_targeting(member, &format!("{path}.targeting"))?),
    };
    let mut hides_caster = false;
    let mut blink = None;
    if let Some(effects) = optional(value, "effects") {
        let effects_path = format!("{path}.effects");
        let SVal::Arr(rows) = effects else {
            // A declared guard rank that never reaches its effects (empty ai) keeps the absent member absent; the raw
            // rank object still carries the exact declaration.
            return Ok(AbilityRank {
                cast_ms,
                targeting,
                hides_caster,
                blink,
                wall: false,
                raw,
            });
        };
        for (index, effect) in rows.iter().enumerate() {
            let effect_path = format!("{effects_path}[{index}]");
            let _ = object(effect, &effect_path)?;
            let Some(operation) = optional(effect, "do") else {
                continue;
            };
            let SVal::Str(operation) = operation else {
                return Err(err(
                    &format!("{effect_path}.do"),
                    "effect verb must be a string",
                ));
            };
            if operation == "status" {
                let to = optional(effect, "to").and_then(|member| match member {
                    SVal::Str(text) => Some(text.as_str()),
                    _ => None,
                });
                let status = optional(effect, "status").and_then(|member| match member {
                    SVal::Str(text) => Some(text.as_str()),
                    _ => None,
                });
                if to == Some("self") && status == Some("hidden") {
                    hides_caster = true;
                }
            } else if operation == "blink" {
                let max_dist = finite_number(effect, "maxDist", &effect_path)?;
                let min_dist = finite_number(effect, "minDist", &effect_path)?;
                blink = Some((max_dist, min_dist));
            }
        }
    }
    Ok(AbilityRank {
        cast_ms,
        targeting,
        hides_caster,
        blink,
        wall: false,
        raw,
    })
}

fn parse_ability_def(value: &SVal, path: &str) -> R<AbilityDef> {
    let raw = method_value(value, path)?;
    let name = match optional(value, "name") {
        None => String::new(),
        Some(SVal::Str(text)) => text.clone(),
        Some(other) => {
            return Err(err(
                &format!("{path}.name"),
                format!("expected a string, got {}", kind_of(other)),
            ))
        }
    };
    let mut ai = Vec::new();
    let mut ai_is_array = false;
    match optional(value, "ai") {
        None => {}
        Some(SVal::Arr(rows)) => {
            ai_is_array = true;
            for (index, row) in rows.iter().enumerate() {
                let tag = match row {
                    SVal::Str(text) => text.clone(),
                    other => {
                        return Err(err(
                            &format!("{path}.ai[{index}]"),
                            format!("expected an AiIntent string, got {}", kind_of(other)),
                        ))
                    }
                };
                ai.push(ai_tag(&tag, &format!("{path}.ai[{index}]"))?);
            }
        }
        Some(other) => {
            return Err(err(
                &format!("{path}.ai"),
                format!("expected an array, got {}", kind_of(other)),
            ))
        }
    }
    let mut blocked_by = Vec::new();
    let mut blocked_is_array = false;
    match optional(value, "blockedBy") {
        None => {}
        Some(SVal::Arr(rows)) => {
            blocked_is_array = true;
            for (index, row) in rows.iter().enumerate() {
                let tag = match row {
                    SVal::Str(text) => text.clone(),
                    other => {
                        return Err(err(
                            &format!("{path}.blockedBy[{index}]"),
                            format!("expected a BlockedBy string, got {}", kind_of(other)),
                        ))
                    }
                };
                blocked_by.push(blocked_by_tag(&tag, &format!("{path}.blockedBy[{index}]"))?);
            }
        }
        Some(other) => {
            return Err(err(
                &format!("{path}.blockedBy"),
                format!("expected an array, got {}", kind_of(other)),
            ))
        }
    }
    let mut ranks = Vec::new();
    match optional(value, "ranks") {
        None => {}
        Some(SVal::Arr(rows)) => {
            for (index, row) in rows.iter().enumerate() {
                ranks.push(parse_ability_rank(row, &format!("{path}.ranks[{index}]"))?);
            }
        }
        Some(other) => {
            return Err(err(
                &format!("{path}.ranks"),
                format!("expected an array, got {}", kind_of(other)),
            ))
        }
    }
    // Source `defOf` also requires array-typed `ai` and `blockedBy`; the admitted guard only checks `ranks`, so a
    // declared boundary object missing those arrays is represented as the guarded-out absence (`ranks` empty) and its
    // complete declaration stays in `raw`.
    if !ai_is_array || !blocked_is_array {
        ranks.clear();
    }
    Ok(AbilityDef {
        name,
        ai,
        blocked_by,
        ranks,
        raw,
    })
}

fn parse_wish(value: &SVal, path: &str) -> R<WishView> {
    closed(
        value,
        &["ability", "def", "rank", "readyAt", "casting"],
        path,
    )?;
    let ability = string_field(value, "ability", path)?;
    let rank = finite_number(value, "rank", path)?;
    let ready_at = finite_number(value, "readyAt", path)?;
    let casting = bool_field(value, "casting", path)?;
    let def = match field(value, "def", path)? {
        SVal::Undefined | SVal::Null => None,
        SVal::Obj(_) => Some(parse_ability_def(
            field(value, "def", path)?,
            &format!("{path}.def"),
        )?),
        other => {
            return Err(err(
                &format!("{path}.def"),
                format!(
                    "expected an opaque def object|null|undefined, got {}",
                    kind_of(other)
                ),
            ))
        }
    };
    Ok(WishView {
        ability,
        def,
        rank,
        ready_at,
        casting,
    })
}

fn parse_source_chest(value: &SVal, path: &str) -> R<SourceChest> {
    require_fields(
        value,
        &["id", "x", "y", "expiresAt", "options", "takenBy", "picked"],
        path,
    )?;
    let options = match field(value, "options", path)? {
        SVal::Null => None,
        SVal::Arr(rows) => {
            let options_path = format!("{path}.options");
            let mut options = Vec::with_capacity(rows.len());
            for (index, row) in rows.iter().enumerate() {
                match row {
                    SVal::Str(text) => options.push(text.clone()),
                    other => {
                        return Err(err(
                            &format!("{options_path}[{index}]"),
                            format!("expected a card id string, got {}", kind_of(other)),
                        ))
                    }
                }
            }
            Some(options)
        }
        other => {
            return Err(err(
                &format!("{path}.options"),
                format!(
                    "expected the readable option array|null, got {}",
                    kind_of(other)
                ),
            ))
        }
    };
    let taken_by = string_array(value, "takenBy", path)?;
    Ok(SourceChest {
        id: string_field(value, "id", path)?,
        x: finite_number(value, "x", path)?,
        y: finite_number(value, "y", path)?,
        expires_at: finite_number(value, "expiresAt", path)?,
        life_ms: match optional(value, "lifeMs") {
            None => None,
            Some(member) => Some(finite_number_value(member, &format!("{path}.lifeMs"))?),
        },
        options,
        taken_by,
        picked: bool_field(value, "picked", path)?,
    })
}

const SELF_NUMBERS: [&str; 13] = [
    "facing",
    "hp",
    "maxHp",
    "barrier",
    "drawStartedAt",
    "readyAt",
    "immuneUntil",
    "sig",
    "brand",
    "power",
    "asMult",
    "speedMult",
    "moveSeq",
];

/// Source percept `self` -> `ModuleSelf`; the complete declared object is retained as the callback `record`.
fn parse_module_self(value: &SVal, path: &str) -> R<ModuleSelf> {
    require_fields(
        value,
        &[
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
        ],
        path,
    )?;
    if let Some(windup) = optional(value, "windupMult") {
        finite_number_value(windup, &format!("{path}.windupMult"))?;
    }
    let status = enum_field(value, "status", &STATUS_NAMES, path)?;
    let mut faction_text = String::new();
    let mut faction = None;
    match field(value, "faction", path)? {
        SVal::Null => {}
        SVal::Str(text) => {
            faction_text = text.clone();
            faction = Some(faction_value(
                field(value, "faction", path)?,
                &format!("{path}.faction"),
            )?);
        }
        other => {
            return Err(err(
                &format!("{path}.faction"),
                format!("expected a faction string|null, got {}", kind_of(other)),
            ))
        }
    }
    let attack_target = match field(value, "attackTarget", path)? {
        SVal::Null => None,
        SVal::Str(text) => Some(text.clone()),
        other => {
            return Err(err(
                &format!("{path}.attackTarget"),
                format!("expected a fighter id string|null, got {}", kind_of(other)),
            ))
        }
    };
    let build = match optional(value, "build") {
        None => None,
        Some(SVal::Null) => None,
        Some(SVal::Obj(_)) => Some(card_counts(
            field(value, "build", path)?,
            &format!("{path}.build"),
        )?),
        Some(other) => {
            return Err(err(
                &format!("{path}.build"),
                format!("expected a card count object|null, got {}", kind_of(other)),
            ))
        }
    };
    for name in SELF_NUMBERS {
        finite_number(value, name, path)?;
    }
    for name in ["kills", "mobKills", "gv", "bounty"] {
        finite_number(value, name, path)?;
    }
    Ok(ModuleSelf {
        id: string_field(value, "id", path)?,
        name: string_field(value, "name", path)?,
        x: finite_number(value, "x", path)?,
        y: finite_number(value, "y", path)?,
        facing: finite_number(value, "facing", path)?,
        status,
        hp: finite_number(value, "hp", path)?,
        max_hp: finite_number(value, "maxHp", path)?,
        barrier: finite_number(value, "barrier", path)?,
        faction_text,
        faction,
        weapons: weapon_pair(value, "weapons", path)?,
        slot: uint_field(value, "slot", 1, path)? as u8,
        attack_target,
        build,
        record: method_value(value, path)?,
    })
}

fn parse_module_hud(value: &SVal, path: &str) -> R<ModuleHud> {
    closed(
        value,
        &[
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
        ],
        path,
    )?;
    let phase = enum_field(
        value,
        "phase",
        &["lobby", "planning", "active", "ended"],
        path,
    )?;
    bool_field(value, "training", path)?;
    for name in [
        "lobbyEndsAt",
        "raidStartedAt",
        "patienceEndsAt",
        "suddenDeathAt",
        "startedWith",
        "alive",
        "playerCount",
        "minPlayers",
    ] {
        finite_number(value, name, path)?;
    }
    string_field(value, "winner", path)?;
    Ok(ModuleHud {
        phase,
        in_coliseum: bool_field(value, "inColiseum", path)?,
        gates_locked: bool_field(value, "gatesLocked", path)?,
        patience_ends_at: finite_number(value, "patienceEndsAt", path)?,
    })
}

fn parse_module_fighter(value: &SVal, path: &str) -> R<ModuleFighter> {
    require_fields(
        value,
        &[
            "id",
            "name",
            "x",
            "y",
            "facing",
            "status",
            "hpFrac",
            "faction",
            "inHand",
            "drawStartedAt",
            "sig",
            "brand",
            "vx",
            "vy",
            "dist",
            "los",
            "central",
            "bot",
            "barrierFrac",
            "bounty",
            "immune",
            "targetable",
            "tint",
        ],
        path,
    )?;
    string_field(value, "id", path)?;
    string_field(value, "name", path)?;
    let status = enum_field(value, "status", &STATUS_NAMES, path)?;
    let faction = opt_faction_value(field(value, "faction", path)?, &format!("{path}.faction"))?;
    weapon_field(value, "inHand", path)?;
    for name in [
        "x",
        "y",
        "facing",
        "hpFrac",
        "drawStartedAt",
        "sig",
        "brand",
        "vx",
        "vy",
        "dist",
        "barrierFrac",
        "bounty",
        "tint",
    ] {
        finite_number(value, name, path)?;
    }
    for name in ["los", "central", "bot", "immune", "targetable"] {
        bool_field(value, name, path)?;
    }
    Ok(ModuleFighter {
        id: string_field(value, "id", path)?,
        x: finite_number(value, "x", path)?,
        y: finite_number(value, "y", path)?,
        status,
        dist: finite_number(value, "dist", path)?,
        los: bool_field(value, "los", path)?,
        targetable: bool_field(value, "targetable", path)?,
        vx: finite_number(value, "vx", path)?,
        vy: finite_number(value, "vy", path)?,
        faction,
    })
}

fn parse_module_mob(value: &SVal, path: &str) -> R<ModuleMob> {
    require_fields(
        value,
        &[
            "id",
            "name",
            "x",
            "y",
            "facing",
            "status",
            "hpFrac",
            "faction",
            "inHand",
            "drawStartedAt",
            "sig",
            "brand",
            "vx",
            "vy",
            "dist",
            "los",
            "central",
            "kind",
        ],
        path,
    )?;
    if let Some(mob_type) = optional(value, "type") {
        match mob_type {
            // The source `MobSeen.type?: string` reads an own `undefined` as absent.
            SVal::Str(_) | SVal::Undefined => {}
            other => {
                return Err(err(
                    &format!("{path}.type"),
                    format!(
                        "expected a mob type string|undefined, got {}",
                        kind_of(other)
                    ),
                ))
            }
        }
    }
    string_field(value, "id", path)?;
    string_field(value, "name", path)?;
    let status = enum_field(value, "status", &STATUS_NAMES, path)?;
    let kind = enum_field(value, "kind", &MOB_KINDS, path)?;
    opt_faction_value(field(value, "faction", path)?, &format!("{path}.faction"))?;
    weapon_field(value, "inHand", path)?;
    for name in [
        "x",
        "y",
        "facing",
        "hpFrac",
        "drawStartedAt",
        "sig",
        "brand",
        "vx",
        "vy",
        "dist",
    ] {
        finite_number(value, name, path)?;
    }
    bool_field(value, "los", path)?;
    bool_field(value, "central", path)?;
    Ok(ModuleMob {
        id: string_field(value, "id", path)?,
        kind,
        x: finite_number(value, "x", path)?,
        y: finite_number(value, "y", path)?,
        status,
        dist: finite_number(value, "dist", path)?,
        los: bool_field(value, "los", path)?,
    })
}

fn validate_container(value: &SVal, path: &str) -> R<()> {
    require_fields(
        value,
        &[
            "id",
            "kind",
            "x",
            "y",
            "closed",
            "weapon",
            "interactable",
            "dist",
            "label",
        ],
        path,
    )?;
    string_field(value, "id", path)?;
    string_field(value, "kind", path)?;
    finite_number(value, "x", path)?;
    finite_number(value, "y", path)?;
    bool_field(value, "closed", path)?;
    match field(value, "weapon", path)? {
        SVal::Undefined | SVal::Null => {}
        member => {
            weapon_value(member, &format!("{path}.weapon"))?;
        }
    }
    bool_field(value, "interactable", path)?;
    finite_number(value, "dist", path)?;
    string_field(value, "label", path)?;
    Ok(())
}

fn validate_projectile(value: &SVal, path: &str) -> R<()> {
    require_fields(
        value,
        &[
            "id", "kind", "x", "y", "vx", "vy", "x0", "y0", "t0", "range", "from",
        ],
        path,
    )?;
    string_field(value, "id", path)?;
    enum_field(value, "kind", &["ball", "arrow"], path)?;
    for name in ["x", "y", "vx", "vy", "x0", "y0", "t0", "range"] {
        finite_number(value, name, path)?;
    }
    match field(value, "from", path)? {
        SVal::Null => {}
        SVal::Str(_) => {}
        other => {
            return Err(err(
                &format!("{path}.from"),
                format!("expected a fighter id string|null, got {}", kind_of(other)),
            ))
        }
    }
    Ok(())
}

fn validate_minimap(value: &SVal, path: &str) -> R<()> {
    closed(value, &["t", "mobs", "gatesLocked"], path)?;
    finite_number(value, "t", path)?;
    bool_field(value, "gatesLocked", path)?;
    for (index, dot) in array_field(value, "mobs", path)?.iter().enumerate() {
        let dot_path = format!("{path}.mobs[{index}]");
        require_fields(dot, &["id", "x", "y", "faction", "elite"], &dot_path)?;
        string_field(dot, "id", &dot_path)?;
        finite_number(dot, "x", &dot_path)?;
        finite_number(dot, "y", &dot_path)?;
        opt_faction_value(
            field(dot, "faction", &dot_path)?,
            &format!("{dot_path}.faction"),
        )?;
        bool_field(dot, "elite", &dot_path)?;
    }
    Ok(())
}

fn parse_module_event(value: &SVal, path: &str) -> R<ModuleEvent> {
    require_fields(value, &["kind", "t", "at"], path)?;
    let kind = enum_field(value, "kind", &EVENT_KINDS, path)?;
    let t = finite_number(value, "t", path)?;
    match field(value, "at", path)? {
        SVal::Null => {}
        at => {
            point_value(at, &format!("{path}.at"))?;
        }
    }
    let mut type_ = None;
    let mut msg = None;
    match kind.as_str() {
        "windup" => {
            require_fields(value, &["by", "weapon", "a", "ms"], path)?;
            string_field(value, "by", path)?;
            let weapon = field(value, "weapon", path)?;
            weapon_value(weapon, &format!("{path}.weapon"))?;
            finite_number(value, "a", path)?;
            finite_number(value, "ms", path)?;
        }
        "swing" => {
            require_fields(value, &["by", "weapon", "a"], path)?;
            string_field(value, "by", path)?;
            weapon_value(field(value, "weapon", path)?, &format!("{path}.weapon"))?;
            finite_number(value, "a", path)?;
        }
        "hit" => {
            require_fields(value, &["id", "by", "amount", "weapon", "sig"], path)?;
            optional_string_or_null(value, "id", path)?;
            optional_string_or_null(value, "by", path)?;
            finite_number(value, "amount", path)?;
            match field(value, "weapon", path)? {
                SVal::Null => {}
                member => {
                    weapon_value(member, &format!("{path}.weapon"))?;
                }
            }
        }
        "block" => {
            require_fields(value, &["id", "by", "weapon"], path)?;
            optional_string_or_null(value, "id", path)?;
            optional_string_or_null(value, "by", path)?;
            match field(value, "weapon", path)? {
                SVal::Null => {}
                member => {
                    weapon_value(member, &format!("{path}.weapon"))?;
                }
            }
        }
        "stagger" | "cancel" => {
            require_fields(value, &["id"], path)?;
            optional_string_or_null(value, "id", path)?;
        }
        "projEnd" => {
            require_fields(value, &["id", "proj", "reason"], path)?;
        }
        "death" => {
            require_fields(value, &["id", "name", "by", "mob"], path)?;
            optional_string_or_null(value, "id", path)?;
            optional_string_or_null(value, "by", path)?;
            bool_field(value, "mob", path)?;
        }
        "heal" => {
            require_fields(value, &["id", "amount"], path)?;
            optional_string_or_null(value, "id", path)?;
            finite_number(value, "amount", path)?;
        }
        "teleport" => {}
        "bounty" => {
            require_fields(value, &["id", "name", "bounty"], path)?;
            optional_string_or_null(value, "id", path)?;
            finite_number(value, "bounty", path)?;
        }
        "victory" => {
            require_fields(value, &["id", "name", "draw"], path)?;
            optional_string_or_null(value, "id", path)?;
            bool_field(value, "draw", path)?;
        }
        "toast" => {
            require_fields(value, &["text"], path)?;
            string_field(value, "text", path)?;
        }
        "result" => {
            require_fields(value, &["result"], path)?;
        }
        "private" => {
            require_fields(value, &["type", "msg"], path)?;
            let declared_type = string_field(value, "type", path)?;
            let record = field(value, "msg", path)?;
            object(record, &format!("{path}.msg"))?;
            type_ = Some(declared_type);
            msg = Some(method_value(record, &format!("{path}.msg"))?);
        }
        "ext" => {
            require_fields(value, &["fx", "data"], path)?;
            string_field(value, "fx", path)?;
            object(field(value, "data", path)?, &format!("{path}.data"))?;
        }
        _ => unreachable!("event kind enum is exhaustive"),
    }
    Ok(ModuleEvent {
        kind,
        t,
        type_,
        msg,
        record: method_value(value, path)?,
    })
}

fn optional_string_or_null(value: &SVal, name: &str, path: &str) -> R<()> {
    match field(value, name, path)? {
        SVal::Null | SVal::Str(_) | SVal::Undefined => Ok(()),
        other => Err(err(
            &format!("{path}.{name}"),
            format!("expected a string|null, got {}", kind_of(other)),
        )),
    }
}

/// The declared `extras` facts the module layer consumes: chests, wish and effect bits (each optional/ordered).
type ParsedExtras = (
    Option<Vec<SourceChest>>,
    Option<WishView>,
    Vec<(String, f64)>,
);

fn parse_extras(value: &SVal, path: &str) -> R<ParsedExtras> {
    let entries = object(value, path)?;
    let mut chests = None;
    let mut wish = None;
    let mut effects: Vec<(String, f64)> = Vec::new();
    for (key, member) in entries {
        match key.as_str() {
            "chests" => {
                let SVal::Arr(rows) = member else {
                    return Err(err(
                        &format!("{path}.chests"),
                        "extras.chests must be an array when present",
                    ));
                };
                let mut parsed = Vec::with_capacity(rows.len());
                for (index, row) in rows.iter().enumerate() {
                    parsed.push(parse_source_chest(row, &format!("{path}.chests[{index}]"))?);
                }
                chests = Some(parsed);
            }
            "wish" => {
                wish = Some(parse_wish(member, &format!("{path}.wish"))?);
            }
            "effects" => {
                let effects_path = format!("{path}.effects");
                let fields = object(member, &effects_path)?;
                for (id, number) in fields {
                    effects.push((
                        id.clone(),
                        finite_number_value(number, &format!("{effects_path}.{id}"))?,
                    ));
                }
            }
            "skills" | "fields" | "camps" | "plan" | "reveals" => {
                // Declared source extras the module layer does not consume; their tagged shape was already decoded.
            }
            other => {
                return Err(err(
                    path,
                    format!("unsupported percept extras field {other}"),
                ));
            }
        }
    }
    Ok((chests, wish, effects))
}

/// Plain JSON for the admitted Memory reader: an own `undefined` mob `type` reads identically to an absent member in
/// source, and that reader only spells explicit `undefined` for a container's weapon.
fn memory_reader_json(input: &SVal, path: &str) -> R<Value> {
    let mut plain = sval_to_json(input, path)?;
    if let Some(mobs) = plain.get_mut("mobs").and_then(Value::as_array_mut) {
        for mob in mobs {
            let Some(object) = mob.as_object_mut() else {
                continue;
            };
            let typed_absent = match object.get("type") {
                None => true,
                Some(Value::Object(marker)) => {
                    marker.len() == 1
                        && marker.get("$rh").and_then(Value::as_str) == Some("undefined")
                }
                Some(_) => false,
            };
            if typed_absent {
                // The admitted reader requires the member to exist and maps null to `None`; source reads an own
                // `undefined` or an absent member identically, so the narrowed row spells both as null.
                object.insert("type".into(), Value::Null);
            }
        }
    }
    Ok(plain)
}

fn parse_percept(input: &SVal, path: &str) -> R<(ModulePercept, MemoryPercept)> {
    closed(
        input,
        &[
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
        ],
        path,
    )?;
    let now = finite_number(input, "now", path)?;
    let view_t = finite_number(input, "viewT", path)?;
    let self_ = parse_module_self(field(input, "self", path)?, &format!("{path}.self"))?;
    let hud = parse_module_hud(field(input, "hud", path)?, &format!("{path}.hud"))?;
    let mut fighters = Vec::new();
    for (index, row) in array_field(input, "fighters", path)?.iter().enumerate() {
        fighters.push(parse_module_fighter(
            row,
            &format!("{path}.fighters[{index}]"),
        )?);
    }
    let mut mobs = Vec::new();
    for (index, row) in array_field(input, "mobs", path)?.iter().enumerate() {
        mobs.push(parse_module_mob(row, &format!("{path}.mobs[{index}]"))?);
    }
    for (index, row) in array_field(input, "containers", path)?.iter().enumerate() {
        validate_container(row, &format!("{path}.containers[{index}]"))?;
    }
    for (index, row) in array_field(input, "projectiles", path)?.iter().enumerate() {
        validate_projectile(row, &format!("{path}.projectiles[{index}]"))?;
    }
    validate_minimap(field(input, "minimap", path)?, &format!("{path}.minimap"))?;
    let mut events = Vec::new();
    for (index, row) in array_field(input, "events", path)?.iter().enumerate() {
        events.push(parse_module_event(row, &format!("{path}.events[{index}]"))?);
    }
    let (chests, wish, effects) =
        parse_extras(field(input, "extras", path)?, &format!("{path}.extras"))?;
    let features = parse_features(field(input, "features", path)?, &format!("{path}.features"))?;
    let percept = ModulePercept {
        now,
        view_t,
        self_,
        hud,
        fighters,
        mobs,
        chests,
        wish,
        effects,
        events,
        features,
    };
    let memory_input = memory_reader_json(input, path)?;
    let memory_percept = super::super::memory::source_input::read_percept(&memory_input, path)
        .map_err(|error| err(path, format!("admitted Memory percept reader: {error}")))?;
    Ok((percept, memory_percept))
}

// ---------------------------------------------------------------------------------------------------------------------
// Declared hunter input.

#[derive(Clone, Debug)]
pub(crate) struct HunterSelf {
    pub(crate) id: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) base: super::types::ChestSelf,
    /// The full declared source `self` object; the replay converts it losslessly for callback arguments.
    pub(crate) raw: SVal,
}

impl HunterSelf {
    pub(crate) fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }

    /// The canonical declared hunt-self row (exact source object retained).
    pub(crate) fn to_hunt_self(&self) -> R<super::types::HuntSelf> {
        Ok(super::types::HuntSelf {
            id: self.id.clone(),
            x: self.x,
            y: self.y,
            base: self.base.clone(),
            raw: Some(method_value(&self.raw, "hunter.self")?),
        })
    }
}

#[derive(Clone, Debug)]
pub(crate) struct HunterChest {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) expires_at: f64,
    pub(crate) life_ms: Option<f64>,
    pub(crate) options: Vec<String>,
    pub(crate) taken_by: Vec<String>,
    pub(crate) pickers: Vec<String>,
    /// The exact declared source row; the replay converts it losslessly for path-callback arguments.
    pub(crate) raw: SVal,
}

impl HunterChest {
    pub(crate) fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }

    /// The canonical declared hunt-chest row (exact source object retained).
    pub(crate) fn to_hunt_chest(&self) -> R<super::types::HuntChest> {
        Ok(super::types::HuntChest {
            id: self.id.clone(),
            kind: self.kind.clone(),
            x: self.x,
            y: self.y,
            expires_at: self.expires_at,
            life_ms: self.life_ms,
            options: self.options.clone(),
            taken_by: self.taken_by.clone(),
            pickers: self.pickers.clone(),
            raw: Some(method_value(&self.raw, "hunter.chest")?),
        })
    }
}

#[derive(Clone, Debug)]
pub(crate) struct HunterInput {
    pub(crate) now: f64,
    pub(crate) server_time: f64,
    pub(crate) self_: HunterSelf,
    pub(crate) chests: Vec<HunterChest>,
    pub(crate) walk: WalkDescriptor,
    pub(crate) sight: SightDescriptor,
    pub(crate) fighting: bool,
    pub(crate) retreating: bool,
    pub(crate) in_coliseum: bool,
    pub(crate) teleport_at: Option<f64>,
}

/// The `ChestSelf` leaves shared by helper args and the hunt self (source `slot`/`risk` stay optional).
fn parse_chest_self(value: &SVal, path: &str) -> R<super::types::ChestSelf> {
    allowed_keys(
        value,
        &[
            "id", "x", "y", "faction", "weapons", "slot", "risk", "build",
        ],
        path,
    )?;
    require_fields(value, &["faction", "weapons", "build"], path)?;
    if let Some(id) = optional(value, "id") {
        match id {
            SVal::Str(_) => {}
            other => {
                return Err(err(
                    &format!("{path}.id"),
                    format!("expected a string, got {}", kind_of(other)),
                ))
            }
        }
    }
    for name in ["x", "y"] {
        if let Some(member) = optional(value, name) {
            finite_number_value(member, &format!("{path}.{name}"))?;
        }
    }
    let faction = string_field(value, "faction", path)?;
    let weapons = weapon_pair(value, "weapons", path)?;
    let build = match optional(value, "build") {
        None | Some(SVal::Null) => None,
        Some(SVal::Obj(_)) => Some(card_counts(
            field(value, "build", path)?,
            &format!("{path}.build"),
        )?),
        Some(other) => {
            return Err(err(
                &format!("{path}.build"),
                format!("expected a card count object|null, got {}", kind_of(other)),
            ))
        }
    };
    let slot = match optional(value, "slot") {
        None | Some(SVal::Undefined) | Some(SVal::Null) => None,
        Some(member) => Some(uint_value(member, 1, &format!("{path}.slot"))? as u8),
    };
    let risk = match optional(value, "risk") {
        None | Some(SVal::Undefined) | Some(SVal::Null) => None,
        Some(member) => Some(finite_number_value(member, &format!("{path}.risk"))?),
    };
    Ok(super::types::ChestSelf {
        faction,
        weapons,
        slot,
        risk,
        build,
    })
}

/// `activeWeapon` consumes only `self.weapons`/`self.slot`; the declared row may state just those (the corpus does),
/// so the other `ChestSelf` leaves stay absent instead of being invented.
fn parse_active_weapon_self(value: &SVal, path: &str) -> R<super::types::ChestSelf> {
    allowed_keys(
        value,
        &[
            "id", "x", "y", "faction", "weapons", "slot", "risk", "build",
        ],
        path,
    )?;
    require_fields(value, &["weapons"], path)?;
    if let Some(member) = optional(value, "id") {
        match member {
            SVal::Str(_) => {}
            other => {
                return Err(err(
                    &format!("{path}.id"),
                    format!("expected a string, got {}", kind_of(other)),
                ))
            }
        }
    }
    for name in ["x", "y"] {
        if let Some(member) = optional(value, name) {
            finite_number_value(member, &format!("{path}.{name}"))?;
        }
    }
    let faction = match optional(value, "faction") {
        None => String::new(),
        Some(SVal::Str(text)) => text.clone(),
        Some(other) => {
            return Err(err(
                &format!("{path}.faction"),
                format!("expected a string, got {}", kind_of(other)),
            ))
        }
    };
    let slot = match optional(value, "slot") {
        None | Some(SVal::Undefined) | Some(SVal::Null) => None,
        Some(member) => Some(uint_value(member, 1, &format!("{path}.slot"))? as u8),
    };
    let risk = match optional(value, "risk") {
        None | Some(SVal::Undefined) | Some(SVal::Null) => None,
        Some(member) => Some(finite_number_value(member, &format!("{path}.risk"))?),
    };
    let build = match optional(value, "build") {
        None | Some(SVal::Null) => None,
        Some(SVal::Obj(_)) => Some(card_counts(
            field(value, "build", path)?,
            &format!("{path}.build"),
        )?),
        Some(other) => {
            return Err(err(
                &format!("{path}.build"),
                format!("expected a card count object|null, got {}", kind_of(other)),
            ))
        }
    };
    Ok(super::types::ChestSelf {
        faction,
        weapons: weapon_pair(value, "weapons", path)?,
        slot,
        risk,
        build,
    })
}

fn parse_hunter_self(value: &SVal, path: &str) -> R<HunterSelf> {
    allowed_keys(
        value,
        &[
            "id", "x", "y", "faction", "weapons", "slot", "risk", "build",
        ],
        path,
    )?;
    require_fields(
        value,
        &["id", "x", "y", "faction", "weapons", "build"],
        path,
    )?;
    let base = parse_chest_self(value, path)?;
    Ok(HunterSelf {
        id: string_field(value, "id", path)?,
        x: finite_number(value, "x", path)?,
        y: finite_number(value, "y", path)?,
        base,
        raw: value.clone(),
    })
}

fn parse_hunter_chest(value: &SVal, path: &str) -> R<HunterChest> {
    allowed_keys(
        value,
        &[
            "id",
            "kind",
            "x",
            "y",
            "expiresAt",
            "lifeMs",
            "options",
            "takenBy",
            "pickers",
        ],
        path,
    )?;
    require_fields(
        value,
        &[
            "id",
            "kind",
            "x",
            "y",
            "expiresAt",
            "options",
            "takenBy",
            "pickers",
        ],
        path,
    )?;
    let options = match field(value, "options", path)? {
        SVal::Arr(rows) => {
            let options_path = format!("{path}.options");
            let mut options = Vec::with_capacity(rows.len());
            for (index, row) in rows.iter().enumerate() {
                match row {
                    SVal::Str(text) => options.push(text.clone()),
                    other => {
                        return Err(err(
                            &format!("{options_path}[{index}]"),
                            format!("expected a card id string, got {}", kind_of(other)),
                        ))
                    }
                }
            }
            options
        }
        other => {
            return Err(err(
                &format!("{path}.options"),
                format!(
                    "the hunt receives the readable option array, got {}",
                    kind_of(other)
                ),
            ))
        }
    };
    Ok(HunterChest {
        id: string_field(value, "id", path)?,
        kind: string_field(value, "kind", path)?,
        x: finite_number(value, "x", path)?,
        y: finite_number(value, "y", path)?,
        expires_at: finite_number(value, "expiresAt", path)?,
        life_ms: match optional(value, "lifeMs") {
            None => None,
            Some(member) => Some(finite_number_value(member, &format!("{path}.lifeMs"))?),
        },
        options,
        taken_by: string_array(value, "takenBy", path)?,
        pickers: string_array(value, "pickers", path)?,
        raw: value.clone(),
    })
}

fn parse_hunter_input(value: &SVal, path: &str) -> R<HunterInput> {
    allowed_keys(
        value,
        &[
            "now",
            "serverTime",
            "self",
            "chests",
            "walk",
            "sight",
            "fighting",
            "retreating",
            "inColiseum",
            "teleportAt",
        ],
        path,
    )?;
    require_fields(
        value,
        &[
            "now",
            "serverTime",
            "self",
            "chests",
            "walk",
            "sight",
            "fighting",
            "retreating",
            "inColiseum",
        ],
        path,
    )?;
    let self_ = parse_hunter_self(field(value, "self", path)?, &format!("{path}.self"))?;
    let mut chests = Vec::new();
    for (index, row) in array_field(value, "chests", path)?.iter().enumerate() {
        chests.push(parse_hunter_chest(row, &format!("{path}.chests[{index}]"))?);
    }
    Ok(HunterInput {
        now: finite_number(value, "now", path)?,
        server_time: finite_number(value, "serverTime", path)?,
        self_,
        chests,
        walk: parse_walk_descriptor(field(value, "walk", path)?, &format!("{path}.walk"))?,
        sight: parse_sight_descriptor(field(value, "sight", path)?, &format!("{path}.sight"))?,
        fighting: bool_field(value, "fighting", path)?,
        retreating: bool_field(value, "retreating", path)?,
        in_coliseum: bool_field(value, "inColiseum", path)?,
        teleport_at: match optional(value, "teleportAt") {
            None => None,
            Some(member) => Some(finite_number_value(member, &format!("{path}.teleportAt"))?),
        },
    })
}

// ---------------------------------------------------------------------------------------------------------------------
// Source goals and declared (adjust) intents.

fn parse_goal(value: &SVal, path: &str) -> R<Goal> {
    let kind = string_field(value, "kind", path)?;
    let fields: &[&str] = match kind.as_str() {
        "idle" => &[],
        "farm" => &["mob", "camp"],
        "hunt" | "fight" => &["target"],
        "loot" => &["container"],
        "flee" => &["from", "until"],
        "roam" => &["to", "why"],
        "hold" => &["at", "why"],
        "module" => &["module", "data"],
        other => {
            return Err(err(
                &format!("{path}.kind"),
                format!("unsupported source goal kind {other}"),
            ))
        }
    };
    let mut allowed = vec!["kind"];
    allowed.extend_from_slice(fields);
    closed(value, &allowed, path)?;
    Ok(match kind.as_str() {
        "idle" => Goal::Idle,
        "farm" => Goal::Farm {
            mob: string_field(value, "mob", path)?,
            camp: match field(value, "camp", path)? {
                SVal::Null => None,
                SVal::Str(text) => Some(text.clone()),
                other => {
                    return Err(err(
                        &format!("{path}.camp"),
                        format!("expected a camp id string|null, got {}", kind_of(other)),
                    ))
                }
            },
        },
        "hunt" => Goal::Hunt {
            target: string_field(value, "target", path)?,
        },
        "fight" => Goal::Fight {
            target: string_field(value, "target", path)?,
        },
        "loot" => Goal::Loot {
            container: string_field(value, "container", path)?,
        },
        "flee" => {
            let mut from = Vec::new();
            for (index, row) in array_field(value, "from", path)?.iter().enumerate() {
                from.push(point_value(row, &format!("{path}.from[{index}]"))?);
            }
            Goal::Flee {
                from,
                until: finite_number(value, "until", path)?,
            }
        }
        "roam" => {
            let why = match string_field(value, "why", path)?.as_str() {
                "explore" => RoamWhy::Explore,
                "camp" => RoamWhy::Camp,
                "lastSeen" => RoamWhy::LastSeen,
                "coliseum" => RoamWhy::Coliseum,
                "centre" => RoamWhy::Centre,
                other => {
                    return Err(err(
                        &format!("{path}.why"),
                        format!("unsupported source roam reason {other}"),
                    ))
                }
            };
            Goal::Roam {
                to: point_field(value, "to", path)?,
                why,
            }
        }
        "hold" => {
            let why = match string_field(value, "why", path)?.as_str() {
                "coliseum" => HoldWhy::Coliseum,
                "ambush" => HoldWhy::Ambush,
                "wait" => HoldWhy::Wait,
                other => {
                    return Err(err(
                        &format!("{path}.why"),
                        format!("unsupported source hold reason {other}"),
                    ))
                }
            };
            Goal::Hold {
                at: point_field(value, "at", path)?,
                why,
            }
        }
        "module" => Goal::Module {
            module: string_field(value, "module", path)?,
            data: method_value(field(value, "data", path)?, &format!("{path}.data"))?,
        },
        _ => unreachable!("goal kind list is exhaustive"),
    })
}

fn parse_declared_intent(value: &SVal, path: &str) -> R<Intent> {
    let kind = string_field(value, "kind", path)?;
    let priority = uint_field(value, "priority", 3, path)? as u8;
    let timing = field(value, "timing", path)?;
    let timing_kind = string_field(timing, "kind", &format!("{path}.timing"))?;
    let timing = match timing_kind.as_str() {
        "step" => {
            closed(timing, &["kind"], &format!("{path}.timing"))?;
            IntentTiming::Step {}
        }
        other => {
            return Err(err(
                &format!("{path}.timing.kind"),
                format!("unsupported declared intent timing {other}"),
            ))
        }
    };
    let why = string_field(value, "why", path)?;
    let body = match kind.as_str() {
        "move" => IntentBody::Move {
            to: point_field(value, "to", path)?,
        },
        "stop" => {
            closed(value, &["kind", "priority", "timing", "why"], path)?;
            IntentBody::Stop {}
        }
        other => {
            return Err(err(
                &format!("{path}.kind"),
                format!("unsupported declared input intent kind {other}"),
            ))
        }
    };
    if kind == "move" {
        closed(value, &["kind", "to", "priority", "timing", "why"], path)?;
    }
    Ok(Intent {
        body,
        priority,
        timing,
        why,
    })
}

// ---------------------------------------------------------------------------------------------------------------------
// Helper leaves.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum HelperName {
    CostsSomething,
    ActiveWeapon,
    CardScore,
    OptionScore,
    ChooseOption,
    Burns,
    Bad,
}

impl HelperName {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::CostsSomething => "costsSomething",
            Self::ActiveWeapon => "activeWeapon",
            Self::CardScore => "cardScore",
            Self::OptionScore => "optionScore",
            Self::ChooseOption => "chooseOption",
            Self::Burns => "burns",
            Self::Bad => "bad",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum HelperArgs {
    Id {
        id: String,
    },
    Self_ {
        self_: super::types::ChestSelf,
    },
    IdSelf {
        id: String,
        self_: super::types::ChestSelf,
    },
    Choose {
        options: Vec<String>,
        taken_by: Vec<String>,
        self_: super::types::ChestSelf,
    },
    MapFactionAt {
        map: String,
        faction: String,
        at: Vec2,
    },
}

fn parse_helper(name: &HelperName, args: &SVal, path: &str, maps: &[MapFixture]) -> R<HelperArgs> {
    match name {
        HelperName::CostsSomething => {
            closed(args, &["id"], path)?;
            Ok(HelperArgs::Id {
                id: string_field(args, "id", path)?,
            })
        }
        HelperName::ActiveWeapon => {
            closed(args, &["self"], path)?;
            Ok(HelperArgs::Self_ {
                self_: parse_active_weapon_self(
                    field(args, "self", path)?,
                    &format!("{path}.self"),
                )?,
            })
        }
        HelperName::CardScore | HelperName::OptionScore => {
            closed(args, &["id", "self"], path)?;
            Ok(HelperArgs::IdSelf {
                id: string_field(args, "id", path)?,
                self_: parse_chest_self(field(args, "self", path)?, &format!("{path}.self"))?,
            })
        }
        HelperName::ChooseOption => {
            closed(args, &["options", "takenBy", "self"], path)?;
            Ok(HelperArgs::Choose {
                options: string_array(args, "options", path)?,
                taken_by: string_array(args, "takenBy", path)?,
                self_: parse_chest_self(field(args, "self", path)?, &format!("{path}.self"))?,
            })
        }
        HelperName::Burns | HelperName::Bad => {
            closed(args, &["map", "faction", "at"], path)?;
            let map = string_field(args, "map", path)?;
            if !maps.iter().any(|fixture| fixture.id == map) {
                return Err(err(
                    &format!("{path}.map"),
                    format!("missing source map label {map:?} in body.maps"),
                ));
            }
            Ok(HelperArgs::MapFactionAt {
                map,
                faction: string_field(args, "faction", path)?,
                at: point_field(args, "at", path)?,
            })
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Declarations, operations, cases.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Method {
    Observe,
    NoteSent,
    RecordChoice,
    Hook,
    Helper,
    HunterDecide,
    HunterMarkDone,
    HunterTried,
    HunterInspect,
    RegistryReset,
    RegistryDefaults,
    RegistryRegister,
    RegistryEnabled,
    RegistryPolicySet,
    RegistryPolicyGet,
}

impl Method {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Observe => "observe",
            Self::NoteSent => "noteSent",
            Self::RecordChoice => "recordChoice",
            Self::Hook => "hook",
            Self::Helper => "helper",
            Self::HunterDecide => "hunter.decide",
            Self::HunterMarkDone => "hunter.markDone",
            Self::HunterTried => "hunter.tried",
            Self::HunterInspect => "hunter.inspect",
            Self::RegistryReset => "registry.reset",
            Self::RegistryDefaults => "registry.defaults",
            Self::RegistryRegister => "registry.register",
            Self::RegistryEnabled => "registry.enabled",
            Self::RegistryPolicySet => "registry.policySet",
            Self::RegistryPolicyGet => "registry.policyGet",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct RegistryRegister {
    pub(crate) builtin: Option<super::types::ModuleId>,
    pub(crate) id: Option<String>,
    pub(crate) token: Option<String>,
    pub(crate) feature: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) enum Declaration {
    Observe {
        cfg: String,
        percept: Box<ModulePercept>,
        memory_percept: Box<MemoryPercept>,
    },
    NoteSent {
        cfg: String,
        input: MemoryTimedCommand,
    },
    RecordChoice {
        cfg: String,
        input: String,
    },
    Hook {
        cfg: String,
        module: super::types::ModuleId,
        name: String,
        features: Option<Features>,
        goal: Option<Goal>,
        engaged: Option<bool>,
        env: EnvSpec,
        intents: Option<Vec<Intent>>,
    },
    Helper {
        name: HelperName,
        args: HelperArgs,
    },
    HunterDecide {
        cfg: String,
        input: HunterInput,
    },
    HunterMarkDone {
        id: String,
    },
    HunterTried {
        id: String,
    },
    HunterInspect,
    RegistryReset,
    RegistryDefaults,
    RegistryRegister(RegistryRegister),
    RegistryEnabled {
        features: Features,
    },
    RegistryPolicySet,
    RegistryPolicyGet,
}

fn module_id(name: &str, path: &str) -> R<super::types::ModuleId> {
    Ok(match name {
        "wishes" => super::types::ModuleId::Wishes,
        "planning" => super::types::ModuleId::Planning,
        "chests" => super::types::ModuleId::Chests,
        "hazards" => super::types::ModuleId::Hazards,
        other => return Err(err(path, format!("unsupported source module {other}"))),
    })
}

fn known_cfg(configs: &BTreeMap<String, SourceConfig>, token: &str, path: &str) -> R<()> {
    if configs.contains_key(token) {
        Ok(())
    } else {
        Err(err(
            path,
            format!("unknown cfg identity token {token} (not declared by this case)"),
        ))
    }
}

struct CaseState {
    observed: BTreeSet<String>,
    observe_now: BTreeMap<String, f64>,
    hunter_now: f64,
    hunter_server: f64,
}

impl CaseState {
    fn new() -> Self {
        Self {
            observed: BTreeSet::new(),
            observe_now: BTreeMap::new(),
            hunter_now: f64::NEG_INFINITY,
            hunter_server: f64::NEG_INFINITY,
        }
    }
}

fn parse_note_sent(value: &SVal, path: &str) -> R<MemoryTimedCommand> {
    closed(
        value,
        &["at", "cmd", "intent", "priority", "stimulus"],
        path,
    )?;
    let at = finite_number(value, "at", path)?;
    let intent = string_field(value, "intent", path)?;
    one_of(
        &intent,
        &[
            "lock", "move", "stop", "swap", "pickup", "cast", "plan", "choose",
        ],
        &format!("{path}.intent"),
    )?;
    uint_field(value, "priority", 3, path)?;
    match field(value, "stimulus", path)? {
        SVal::Null => {}
        SVal::Obj(_) => {}
        other => {
            return Err(err(
                &format!("{path}.stimulus"),
                format!("expected a stimulus object|null, got {}", kind_of(other)),
            ))
        }
    }
    let command = field(value, "cmd", path)?;
    closed(command, &["type", "msg"], &format!("{path}.cmd"))?;
    let command_type = enum_field(command, "type", &COMMAND_TYPES, &format!("{path}.cmd"))?;
    let message = field(command, "msg", path)?;
    let message_path = format!("{path}.cmd.msg");
    let entries = object(message, &message_path)?;
    let find = |name: &str| {
        entries
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, member)| member)
    };
    let required_number = |name: &str| -> R<f64> {
        match find(name) {
            Some(member) => finite_number_value(member, &format!("{message_path}.{name}")),
            None => Err(err(
                &format!("{message_path}.{name}"),
                "missing consumed command field",
            )),
        }
    };
    let optional_number = |name: &str| -> R<Option<f64>> {
        match find(name) {
            None => Ok(None),
            Some(member) => Ok(Some(finite_number_value(
                member,
                &format!("{message_path}.{name}"),
            )?)),
        }
    };
    let required_string = |name: &str| -> R<String> {
        match find(name) {
            Some(SVal::Str(text)) => Ok(text.clone()),
            Some(other) => Err(err(
                &format!("{message_path}.{name}"),
                format!("expected a string, got {}", kind_of(other)),
            )),
            None => Err(err(
                &format!("{message_path}.{name}"),
                "missing consumed command field",
            )),
        }
    };
    let command_typed = match command_type.as_str() {
        "move" => MemoryCommand::Move {
            x: required_number("x")?,
            y: required_number("y")?,
            seq: optional_number("seq")?,
        },
        "stop" => MemoryCommand::Stop {
            seq: optional_number("seq")?,
        },
        "target" => MemoryCommand::Target {
            id: required_string("id")?,
        },
        "pickup" => MemoryCommand::Pickup {
            container_id: required_string("containerId")?,
        },
        "cast" => MemoryCommand::Cast,
        _ => MemoryCommand::Other,
    };
    Ok(MemoryTimedCommand {
        at,
        cmd: command_typed,
        raw: method_value(value, path)?,
    })
}

fn parse_declaration(
    method: &Method,
    declaration: &SVal,
    path: &str,
    maps: &[MapFixture],
    configs: &BTreeMap<String, SourceConfig>,
    state: &mut CaseState,
) -> R<Declaration> {
    let declared_method = string_field(declaration, "method", path)
        .map_err(|_| err(path, "declaration must have a method field"))?;
    if declared_method != method.as_str() {
        return Err(err(
            &format!("{path}.method"),
            format!(
                "declaration method {declared_method} differs from operation method {}",
                method.as_str()
            ),
        ));
    }
    match method {
        Method::Observe => {
            closed(declaration, &["method", "cfg", "input"], path)?;
            let cfg = string_field(declaration, "cfg", path)?;
            known_cfg(configs, &cfg, &format!("{path}.cfg"))?;
            let (percept, memory_percept) =
                parse_percept(field(declaration, "input", path)?, &format!("{path}.input"))?;
            match state.observe_now.get(&cfg) {
                Some(previous) if percept.now < *previous => {
                    return Err(err(
                        &format!("{path}.input.now"),
                        format!(
                            "Memory clock went backwards for cfg {cfg}: {} after {previous}",
                            percept.now
                        ),
                    ))
                }
                _ => {}
            }
            state.observe_now.insert(cfg.clone(), percept.now);
            state.observed.insert(cfg.clone());
            Ok(Declaration::Observe {
                cfg,
                percept: Box::new(percept),
                memory_percept: Box::new(memory_percept),
            })
        }
        Method::NoteSent => {
            closed(declaration, &["method", "cfg", "input"], path)?;
            let cfg = string_field(declaration, "cfg", path)?;
            known_cfg(configs, &cfg, &format!("{path}.cfg"))?;
            let input =
                parse_note_sent(field(declaration, "input", path)?, &format!("{path}.input"))?;
            Ok(Declaration::NoteSent { cfg, input })
        }
        Method::RecordChoice => {
            closed(declaration, &["method", "cfg", "input"], path)?;
            let cfg = string_field(declaration, "cfg", path)?;
            known_cfg(configs, &cfg, &format!("{path}.cfg"))?;
            Ok(Declaration::RecordChoice {
                cfg,
                input: string_field(declaration, "input", path)?,
            })
        }
        Method::Hook => {
            allowed_keys(
                declaration,
                &[
                    "method", "cfg", "module", "name", "features", "goal", "engaged", "env",
                    "intents",
                ],
                path,
            )?;
            require_fields(declaration, &["method", "cfg", "module", "name"], path)?;
            let cfg = string_field(declaration, "cfg", path)?;
            known_cfg(configs, &cfg, &format!("{path}.cfg"))?;
            let module_name = string_field(declaration, "module", path)?;
            let module = module_id(&module_name, &format!("{path}.module"))?;
            let name = string_field(declaration, "name", path)?;
            one_of(&name, &HOOK_NAMES, &format!("{path}.name"))?;
            if !module.hooks().contains(&name.as_str()) {
                return Err(err(
                    &format!("{path}.name"),
                    format!("source module {module_name} does not declare hook {name}"),
                ));
            }
            let features = match optional(declaration, "features") {
                None => None,
                Some(member) => Some(parse_features(member, &format!("{path}.features"))?),
            };
            let goal = match optional(declaration, "goal") {
                None => None,
                Some(member) => Some(parse_goal(member, &format!("{path}.goal"))?),
            };
            let engaged = match optional(declaration, "engaged") {
                None => None,
                Some(SVal::Bool(flag)) => Some(*flag),
                Some(other) => {
                    return Err(err(
                        &format!("{path}.engaged"),
                        format!("expected a bool, got {}", kind_of(other)),
                    ))
                }
            };
            let env = match optional(declaration, "env") {
                None => EnvSpec {
                    path: None,
                    learned: None,
                },
                Some(member) => parse_env_spec(member, &format!("{path}.env"))?,
            };
            let intents = match optional(declaration, "intents") {
                None => None,
                Some(SVal::Arr(rows)) => {
                    let mut parsed = Vec::with_capacity(rows.len());
                    for (index, row) in rows.iter().enumerate() {
                        parsed.push(parse_declared_intent(
                            row,
                            &format!("{path}.intents[{index}]"),
                        )?);
                    }
                    Some(parsed)
                }
                Some(other) => {
                    return Err(err(
                        &format!("{path}.intents"),
                        format!("expected an intent array, got {}", kind_of(other)),
                    ))
                }
            };
            if name == "enabled" {
                // Only the enabled hook may be called without an observed percept; the caller falls back to the
                // declared cfg features when the declaration does not restate them.
            } else if !state.observed.contains(&cfg) {
                return Err(err(
                    path,
                    format!("source observe for cfg {cfg} must precede a real module hook"),
                ));
            }
            if matches!(name.as_str(), "intents" | "act" | "adjust") && goal.is_none() {
                return Err(err(
                    path,
                    format!("hook {name} consumes a declared source goal"),
                ));
            }
            if name == "act" {
                match &goal {
                    Some(Goal::Module { .. }) => {}
                    _ => {
                        return Err(err(
                            &format!("{path}.goal"),
                            "the source act hook only executes module goals",
                        ))
                    }
                }
            }
            if name == "adjust" && intents.is_none() {
                return Err(err(
                    path,
                    "the source adjust hook consumes the caller's intent list",
                ));
            }
            Ok(Declaration::Hook {
                cfg,
                module,
                name,
                features,
                goal,
                engaged,
                env,
                intents,
            })
        }
        Method::Helper => {
            closed(declaration, &["method", "name", "args"], path)?;
            let name = match string_field(declaration, "name", path)?.as_str() {
                "costsSomething" => HelperName::CostsSomething,
                "activeWeapon" => HelperName::ActiveWeapon,
                "cardScore" => HelperName::CardScore,
                "optionScore" => HelperName::OptionScore,
                "chooseOption" => HelperName::ChooseOption,
                "burns" => HelperName::Burns,
                "bad" => HelperName::Bad,
                other => {
                    return Err(err(
                        &format!("{path}.name"),
                        format!("unsupported source helper {other}"),
                    ))
                }
            };
            let args = parse_helper(
                &name,
                field(declaration, "args", path)?,
                &format!("{path}.args"),
                maps,
            )?;
            Ok(Declaration::Helper { name, args })
        }
        Method::HunterDecide => {
            closed(declaration, &["method", "cfg", "input"], path)?;
            let cfg = string_field(declaration, "cfg", path)?;
            known_cfg(configs, &cfg, &format!("{path}.cfg"))?;
            let input =
                parse_hunter_input(field(declaration, "input", path)?, &format!("{path}.input"))?;
            if input.now < state.hunter_now || input.server_time < state.hunter_server {
                return Err(err(
                    &format!("{path}.input"),
                    format!(
                        "independent Hunter clocks must be nondecreasing: now {} after {}, serverTime {} after {}",
                        input.now, state.hunter_now, input.server_time, state.hunter_server
                    ),
                ));
            }
            state.hunter_now = input.now;
            state.hunter_server = input.server_time;
            Ok(Declaration::HunterDecide { cfg, input })
        }
        Method::HunterMarkDone | Method::HunterTried => {
            closed(declaration, &["method", "id"], path)?;
            let id = string_field(declaration, "id", path)?;
            Ok(if matches!(method, Method::HunterMarkDone) {
                Declaration::HunterMarkDone { id }
            } else {
                Declaration::HunterTried { id }
            })
        }
        Method::HunterInspect => {
            closed(declaration, &["method"], path)?;
            Ok(Declaration::HunterInspect)
        }
        Method::RegistryReset => {
            closed(declaration, &["method"], path)?;
            Ok(Declaration::RegistryReset)
        }
        Method::RegistryDefaults => {
            closed(declaration, &["method"], path)?;
            Ok(Declaration::RegistryDefaults)
        }
        Method::RegistryRegister => {
            allowed_keys(
                declaration,
                &["method", "builtin", "id", "token", "feature"],
                path,
            )?;
            require_fields(declaration, &["method"], path)?;
            if let Some(builtin) = optional(declaration, "builtin") {
                let name = match builtin {
                    SVal::Str(name) => name.clone(),
                    other => {
                        return Err(err(
                            &format!("{path}.builtin"),
                            format!("expected the builtin module name, got {}", kind_of(other)),
                        ))
                    }
                };
                let module = module_id(&name, &format!("{path}.builtin"))?;
                Ok(Declaration::RegistryRegister(RegistryRegister {
                    builtin: Some(module),
                    id: None,
                    token: None,
                    feature: None,
                }))
            } else {
                let feature = enum_field(
                    declaration,
                    "feature",
                    &["always", "wishes", "planning", "chests", "hazards"],
                    path,
                )?;
                Ok(Declaration::RegistryRegister(RegistryRegister {
                    builtin: None,
                    id: Some(string_field(declaration, "id", path)?),
                    token: Some(string_field(declaration, "token", path)?),
                    feature: Some(feature),
                }))
            }
        }
        Method::RegistryEnabled => {
            closed(declaration, &["method", "features"], path)?;
            Ok(Declaration::RegistryEnabled {
                features: parse_features(
                    field(declaration, "features", path)?,
                    &format!("{path}.features"),
                )?,
            })
        }
        Method::RegistryPolicySet => {
            closed(declaration, &["method"], path)?;
            Ok(Declaration::RegistryPolicySet)
        }
        Method::RegistryPolicyGet => {
            closed(declaration, &["method"], path)?;
            Ok(Declaration::RegistryPolicyGet)
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ContextExpected {
    pub(crate) memory: SVal,
    pub(crate) draw_counts: [u64; 4],
    pub(crate) path_stats: SVal,
}

fn parse_draw_counts(value: &Value, path: &str) -> R<[u64; 4]> {
    let object = value
        .as_object()
        .ok_or_else(|| err(path, "drawCounts must be a plain JSON object"))?;
    let lanes = ["decide", "motor", "lapse", "knowledge"];
    if object.len() != lanes.len() {
        return Err(err(
            path,
            format!("drawCounts must declare exactly {lanes:?}"),
        ));
    }
    let mut counts = [0u64; 4];
    for (index, lane) in lanes.iter().enumerate() {
        let count = object
            .get(*lane)
            .and_then(Value::as_u64)
            .ok_or_else(|| err(&format!("{path}.{lane}"), "draw count must be a uint"))?;
        counts[index] = count;
    }
    Ok(counts)
}

fn parse_context_expected(value: &Value, path: &str) -> R<ContextExpected> {
    let object = value
        .as_object()
        .ok_or_else(|| err(path, "expected a context state object"))?;
    for key in object.keys() {
        if !["memory", "drawCounts", "pathStats"].contains(&key.as_str()) {
            return Err(err(path, format!("unsupported context state field {key}")));
        }
    }
    for key in ["memory", "drawCounts", "pathStats"] {
        if !object.contains_key(key) {
            return Err(err(path, format!("missing context state field {key}")));
        }
    }
    Ok(ContextExpected {
        memory: decode_diagnostic(&object["memory"], &format!("{path}.memory"))?,
        draw_counts: parse_draw_counts(&object["drawCounts"], &format!("{path}.drawCounts"))?,
        path_stats: decode_diagnostic(&object["pathStats"], &format!("{path}.pathStats"))?,
    })
}

fn parse_contexts(
    value: &Value,
    configs: &BTreeMap<String, SourceConfig>,
    path: &str,
) -> R<Vec<(String, ContextExpected)>> {
    let object = value
        .as_object()
        .ok_or_else(|| err(path, "context states must be a plain JSON object"))?;
    let mut contexts = Vec::with_capacity(object.len());
    for (token, context) in object {
        known_cfg(configs, token, &format!("{path}.{token}"))?;
        contexts.push((
            token.clone(),
            parse_context_expected(context, &format!("{path}.{token}"))?,
        ));
    }
    Ok(contexts)
}

#[derive(Clone, Debug)]
pub(crate) struct Initial {
    pub(crate) contexts: Vec<(String, ContextExpected)>,
    pub(crate) hunter_own: SVal,
    pub(crate) target: SVal,
    pub(crate) stats: SVal,
}

#[derive(Clone, Debug)]
pub(crate) struct HunterExpected {
    pub(crate) own: SVal,
    pub(crate) target: SVal,
    pub(crate) stats: SVal,
}

fn parse_hunter_expected(value: &Value, path: &str) -> R<HunterExpected> {
    let object = value
        .as_object()
        .ok_or_else(|| err(path, "hunter state must be a plain JSON object"))?;
    for key in object.keys() {
        if !["own", "target", "stats"].contains(&key.as_str()) {
            return Err(err(path, format!("unsupported hunter state field {key}")));
        }
    }
    for key in ["own", "target", "stats"] {
        if !object.contains_key(key) {
            return Err(err(path, format!("missing hunter state field {key}")));
        }
    }
    Ok(HunterExpected {
        own: decode_diagnostic(&object["own"], &format!("{path}.own"))?,
        target: plain_to_sval(&object["target"], &format!("{path}.target"))?,
        stats: decode_diagnostic(&object["stats"], &format!("{path}.stats"))?,
    })
}

fn parse_initial(
    value: &Value,
    configs: &BTreeMap<String, SourceConfig>,
    path: &str,
) -> R<Initial> {
    let object = value
        .as_object()
        .ok_or_else(|| err(path, "initial must be a plain JSON object"))?;
    for key in object.keys() {
        if !["contexts", "hunter", "target", "stats"].contains(&key.as_str()) {
            return Err(err(path, format!("unsupported initial field {key}")));
        }
    }
    for key in ["contexts", "hunter", "target", "stats"] {
        if !object.contains_key(key) {
            return Err(err(path, format!("missing initial field {key}")));
        }
    }
    Ok(Initial {
        contexts: parse_contexts(&object["contexts"], configs, &format!("{path}.contexts"))?,
        hunter_own: decode_diagnostic(&object["hunter"], &format!("{path}.hunter"))?,
        target: plain_to_sval(&object["target"], &format!("{path}.target"))?,
        stats: decode_diagnostic(&object["stats"], &format!("{path}.stats"))?,
    })
}

fn validate_callbacks(value: &SVal, path: &str) -> R<()> {
    let SVal::Arr(rows) = value else {
        return Err(err(path, "callbacks must be a tagged array"));
    };
    for (index, row) in rows.iter().enumerate() {
        let row_path = format!("{path}[{index}]");
        let entries = object(row, &row_path)?;
        let find = |name: &str| {
            entries
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value)
        };
        match find("sequence") {
            Some(SVal::Num(sequence)) if *sequence == index as f64 => {}
            other => {
                return Err(err(
                    &format!("{row_path}.sequence"),
                    format!("expected the ordered position {index}, got {other:?}"),
                ))
            }
        }
        match find("kind") {
            Some(SVal::Str(kind)) if kind == "callback" || kind == "rng" => {}
            other => {
                return Err(err(
                    &format!("{row_path}.kind"),
                    format!("unsupported transcript kind {other:?}"),
                ))
            }
        }
        if matches!(find("kind"), Some(SVal::Str(kind)) if kind == "rng") {
            match find("stream") {
                Some(SVal::Str(stream))
                    if matches!(stream.as_str(), "decide" | "motor" | "lapse" | "knowledge") => {}
                other => {
                    return Err(err(
                        &format!("{row_path}.stream"),
                        format!("unsupported declared RNG lane {other:?}"),
                    ))
                }
            }
            match find("value") {
                Some(SVal::Num(value)) if value.is_finite() && *value >= 0. && *value < 1. => {}
                other => {
                    return Err(err(
                        &format!("{row_path}.value"),
                        format!("declared RNG draw must be a unit interval value, got {other:?}"),
                    ))
                }
            }
        }
    }
    Ok(())
}

fn parse_identity(value: &Value, path: &str) -> R<SVal> {
    let identity = plain_to_sval(value, path)?;
    closed(&identity, &["returnedInputList"], path)?;
    bool_field(&identity, "returnedInputList", path)?;
    Ok(identity)
}

#[derive(Clone, Debug)]
pub(crate) struct Operation {
    pub(crate) method: Method,
    pub(crate) declaration: Declaration,
    pub(crate) expected_result: SVal,
    pub(crate) expected_contexts: Vec<(String, ContextExpected)>,
    pub(crate) expected_hunter: HunterExpected,
    pub(crate) expected_callbacks: SVal,
    pub(crate) resolved_input: Option<SVal>,
    pub(crate) identity: Option<SVal>,
}

fn parse_operation(
    raw: &Value,
    path: &str,
    maps: &[MapFixture],
    configs: &BTreeMap<String, SourceConfig>,
    state: &mut CaseState,
) -> R<Operation> {
    let object = raw
        .as_object()
        .ok_or_else(|| err(path, "operation must be a plain JSON object"))?;
    for key in object.keys() {
        if ![
            "method",
            "declaration",
            "result",
            "contexts",
            "hunter",
            "callbacks",
            "resolvedInput",
            "identity",
        ]
        .contains(&key.as_str())
        {
            return Err(err(path, format!("unsupported operation field {key}")));
        }
    }
    for key in [
        "method",
        "declaration",
        "result",
        "contexts",
        "hunter",
        "callbacks",
    ] {
        if !object.contains_key(key) {
            return Err(err(path, format!("missing operation field {key}")));
        }
    }
    let method_name = object["method"].as_str().ok_or_else(|| {
        err(
            &format!("{path}.method"),
            "operation method must be a string",
        )
    })?;
    one_of(method_name, &METHODS, &format!("{path}.method"))?;
    let method = match method_name {
        "observe" => Method::Observe,
        "noteSent" => Method::NoteSent,
        "recordChoice" => Method::RecordChoice,
        "hook" => Method::Hook,
        "helper" => Method::Helper,
        "hunter.decide" => Method::HunterDecide,
        "hunter.markDone" => Method::HunterMarkDone,
        "hunter.tried" => Method::HunterTried,
        "hunter.inspect" => Method::HunterInspect,
        "registry.reset" => Method::RegistryReset,
        "registry.defaults" => Method::RegistryDefaults,
        "registry.register" => Method::RegistryRegister,
        "registry.enabled" => Method::RegistryEnabled,
        "registry.policySet" => Method::RegistryPolicySet,
        "registry.policyGet" => Method::RegistryPolicyGet,
        _ => unreachable!("method enum list is exhaustive"),
    };
    let declaration_path = format!("{path}.declaration");
    let declaration_sval = decode_input(&object["declaration"], &declaration_path)?;
    check_declaration_finite(&declaration_sval, &declaration_path)?;
    let declaration = parse_declaration(
        &method,
        &declaration_sval,
        &declaration_path,
        maps,
        configs,
        state,
    )?;
    let expected_result = decode_diagnostic(&object["result"], &format!("{path}.result"))?;
    let expected_contexts =
        parse_contexts(&object["contexts"], configs, &format!("{path}.contexts"))?;
    let expected_hunter = parse_hunter_expected(&object["hunter"], &format!("{path}.hunter"))?;
    let expected_callbacks = decode_diagnostic(&object["callbacks"], &format!("{path}.callbacks"))?;
    validate_callbacks(&expected_callbacks, &format!("{path}.callbacks"))?;
    let resolved_input = match object.get("resolvedInput") {
        None => None,
        Some(value) => Some(decode_diagnostic(value, &format!("{path}.resolvedInput"))?),
    };
    let identity = match object.get("identity") {
        None => None,
        Some(value) => Some(parse_identity(value, &format!("{path}.identity"))?),
    };
    Ok(Operation {
        method,
        declaration,
        expected_result,
        expected_contexts,
        expected_hunter,
        expected_callbacks,
        resolved_input,
        identity,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Suite {
    Choice,
    Hunter,
    Chests,
    Planning,
    Wishes,
    Hazards,
    Registry,
}

impl Suite {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Choice => "choice",
            Self::Hunter => "hunter",
            Self::Chests => "chests",
            Self::Planning => "planning",
            Self::Wishes => "wishes",
            Self::Hazards => "hazards",
            Self::Registry => "registry",
        }
    }
}

fn parse_hunter_config(value: &SVal, path: &str) -> R<ChestHuntConfig> {
    closed(
        value,
        &[
            "pickRange",
            "pickMarginMs",
            "holdMs",
            "arriveSlackMs",
            "paceShare",
            "fightWalk",
            "stallMs",
            "stallProgress",
            "stallStepMaxMs",
            "maxCandidates",
            "walkCacheMs",
        ],
        path,
    )?;
    Ok(ChestHuntConfig {
        pick_range: finite_number(value, "pickRange", path)?,
        pick_margin_ms: finite_number(value, "pickMarginMs", path)?,
        hold_ms: finite_number(value, "holdMs", path)?,
        arrive_slack_ms: finite_number(value, "arriveSlackMs", path)?,
        pace_share: finite_number(value, "paceShare", path)?,
        fight_walk: finite_number(value, "fightWalk", path)?,
        stall_ms: finite_number(value, "stallMs", path)?,
        stall_progress: finite_number(value, "stallProgress", path)?,
        stall_step_max_ms: finite_number(value, "stallStepMaxMs", path)?,
        max_candidates: finite_number(value, "maxCandidates", path)?,
        walk_cache_ms: finite_number(value, "walkCacheMs", path)?,
    })
}

#[derive(Clone, Debug)]
pub(crate) struct Case {
    pub(crate) id: String,
    pub(crate) suite: Suite,
    pub(crate) covers: Vec<String>,
    pub(crate) configs: BTreeMap<String, SourceConfig>,
    pub(crate) hunter_config: ChestHuntConfig,
    pub(crate) initial: Initial,
    pub(crate) setup_transcript: SVal,
    pub(crate) operations: Vec<Operation>,
}

fn parse_case(raw: &Value, maps: &[MapFixture], path: &str) -> R<Case> {
    let object = raw
        .as_object()
        .ok_or_else(|| err(path, "case must be a plain JSON object"))?;
    for key in object.keys() {
        if ![
            "id",
            "suite",
            "covers",
            "configs",
            "hunterConfig",
            "initial",
            "setupTranscript",
            "operations",
        ]
        .contains(&key.as_str())
        {
            return Err(err(path, format!("unsupported case field {key}")));
        }
    }
    for key in [
        "id",
        "suite",
        "covers",
        "configs",
        "hunterConfig",
        "initial",
        "setupTranscript",
        "operations",
    ] {
        if !object.contains_key(key) {
            return Err(err(path, format!("missing case field {key}")));
        }
    }
    let id = object["id"]
        .as_str()
        .filter(|id| !id.is_empty())
        .ok_or_else(|| err(&format!("{path}.id"), "case id must be a non-empty string"))?
        .to_string();
    let suite_name = object["suite"]
        .as_str()
        .ok_or_else(|| err(&format!("{path}.suite"), "case suite must be a string"))?;
    one_of(suite_name, &SUITES, &format!("{path}.suite"))?;
    let suite = match suite_name {
        "choice" => Suite::Choice,
        "hunter" => Suite::Hunter,
        "chests" => Suite::Chests,
        "planning" => Suite::Planning,
        "wishes" => Suite::Wishes,
        "hazards" => Suite::Hazards,
        "registry" => Suite::Registry,
        _ => unreachable!("suite enum list is exhaustive"),
    };
    let covers = match object["covers"].as_array() {
        Some(covers) if !covers.is_empty() => {
            let mut parsed = Vec::with_capacity(covers.len());
            for (index, cover) in covers.iter().enumerate() {
                parsed.push(
                    cover
                        .as_str()
                        .ok_or_else(|| {
                            err(
                                &format!("{path}.covers[{index}]"),
                                "cover declaration must be a string",
                            )
                        })?
                        .to_string(),
                );
            }
            parsed
        }
        _ => {
            return Err(err(
                &format!("{path}.covers"),
                "covers must be a non-empty array of strings",
            ))
        }
    };
    let configs_path = format!("{path}.configs");
    let configs_sval = decode_input(&object["configs"], &configs_path)?;
    let config_entries = match &configs_sval {
        SVal::Obj(entries) => entries.clone(),
        other => {
            return Err(err(
                &configs_path,
                format!("expected the declared cfg map, got {}", kind_of(other)),
            ))
        }
    };
    let mut configs: BTreeMap<String, SourceConfig> = BTreeMap::new();
    for (token, config) in &config_entries {
        let config_path = format!("{configs_path}.{token}");
        check_config_finite(config, &config_path)?;
        let parsed = parse_config(config, token, maps, &config_path)?;
        if configs.insert(token.clone(), parsed).is_some() {
            return Err(err(&configs_path, format!("duplicate cfg token {token}")));
        }
    }
    let hunter_config_path = format!("{path}.hunterConfig");
    let hunter_config = parse_hunter_config(
        &decode_input(&object["hunterConfig"], &hunter_config_path)?,
        &hunter_config_path,
    )?;
    let initial = parse_initial(&object["initial"], &configs, &format!("{path}.initial"))?;
    let setup_transcript_path = format!("{path}.setupTranscript");
    let setup_transcript = decode_diagnostic(&object["setupTranscript"], &setup_transcript_path)?;
    if !matches!(setup_transcript, SVal::Arr(_)) {
        return Err(err(
            &setup_transcript_path,
            "setup transcript must be a tagged array",
        ));
    }
    let operation_rows = object["operations"]
        .as_array()
        .filter(|rows| !rows.is_empty())
        .ok_or_else(|| {
            err(
                &format!("{path}.operations"),
                "case operations must be a non-empty array",
            )
        })?;
    let mut state = CaseState::new();
    let mut operations = Vec::with_capacity(operation_rows.len());
    for (index, row) in operation_rows.iter().enumerate() {
        operations.push(parse_operation(
            row,
            &format!("{path}.operations[{index}]"),
            maps,
            &configs,
            &mut state,
        )?);
    }
    Ok(Case {
        id,
        suite,
        covers,
        configs,
        hunter_config,
        initial,
        setup_transcript,
        operations,
    })
}

// ---------------------------------------------------------------------------------------------------------------------
// Body.

fn body_object_keys() -> [&'static str; 6] {
    [
        "format",
        "methodValue",
        "profile",
        "maps",
        "catalog",
        "cases",
    ]
}

pub(crate) fn build_body(raw: &Value) -> R<Source> {
    let body = raw.as_object().ok_or_else(|| {
        "source: expected the rh-bot-private-modules-source/1 envelope object".to_string()
    })?;
    let expected = body_object_keys();
    for key in body.keys() {
        if !expected.contains(&key.as_str()) {
            return Err(format!("source: unsupported envelope field {key}"));
        }
    }
    for key in expected {
        if !body.contains_key(key) {
            return Err(format!("source: missing envelope field {key}"));
        }
    }
    match body["format"].as_str() {
        Some(format) if format == SOURCE_FORMAT => {}
        other => {
            return Err(format!(
                "source.format: expected {SOURCE_FORMAT}, got {other:?}"
            ))
        }
    }
    match body["methodValue"].as_str() {
        Some(format) if format == METHOD_VALUE_FORMAT => {}
        other => {
            return Err(format!(
                "source.methodValue: expected {METHOD_VALUE_FORMAT}, got {other:?}"
            ))
        }
    }
    if !body["profile"].is_object() {
        return Err("source.profile: expected the declared capture profile object".into());
    }
    let map_rows = body["maps"]
        .as_array()
        .filter(|rows| !rows.is_empty())
        .ok_or_else(|| "source.maps: expected a non-empty map array".to_string())?;
    let mut maps: Vec<MapFixture> = Vec::with_capacity(map_rows.len());
    let mut map_ids: BTreeSet<String> = BTreeSet::new();
    for (index, row) in map_rows.iter().enumerate() {
        let fixture = parse_map_fixture(row, &format!("source.maps[{index}]"))?;
        if !map_ids.insert(fixture.id.clone()) {
            return Err(format!(
                "source.maps: duplicate source map id {:?}",
                fixture.id
            ));
        }
        maps.push(fixture);
    }
    let catalog = parse_catalog(&body["catalog"], "source.catalog")?;
    let case_rows = body["cases"]
        .as_array()
        .ok_or_else(|| "source.cases: expected a case array".to_string())?;
    let mut case_ids: BTreeSet<String> = BTreeSet::new();
    let mut cases = Vec::with_capacity(case_rows.len());
    for (index, row) in case_rows.iter().enumerate() {
        let case = parse_case(row, &maps, &format!("source.cases[{index}]"))?;
        if !case_ids.insert(case.id.clone()) {
            return Err(format!("source.cases: duplicate case id {:?}", case.id));
        }
        cases.push(case);
    }
    Ok(Source {
        maps,
        catalog,
        cases,
    })
}

/// Full atomic validation of an owned raw envelope. Side-effect free: it converts into owned values and drops them.
pub(crate) fn validate_body(raw: &Value) -> R<()> {
    build_body(raw).map(|_| ())
}

/// Read and convert the frozen private-modules corpus.
pub(crate) fn load() -> R<Source> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(SOURCE_RELATIVE_PATH);
    let text = std::fs::read_to_string(&path)
        .map_err(|error| format!("frozen source {}: {error}", path.display()))?;
    body_from_str(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn corpus_path() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(SOURCE_RELATIVE_PATH)
    }

    fn corpus_text() -> String {
        std::fs::read_to_string(corpus_path()).expect("frozen private-modules source.json")
    }

    fn body() -> Value {
        parse_raw(&corpus_text()).expect("strict raw parse")
    }

    /// One field of a `{$:'object',entries:[[key,value],...]}` tagged envelope.
    fn tagged_field<'a>(tagged: &'a mut Value, name: &str) -> &'a mut Value {
        let entries = tagged
            .get_mut("entries")
            .and_then(Value::as_array_mut)
            .expect("tagged object entries");
        let pair = entries
            .iter_mut()
            .find(|pair| pair[0].as_str() == Some(name))
            .unwrap_or_else(|| panic!("missing tagged field {name}"));
        &mut pair[1]
    }

    fn tagged_field_ref<'a>(tagged: &'a Value, name: &str) -> &'a Value {
        let entries = tagged
            .get("entries")
            .and_then(Value::as_array)
            .expect("tagged object entries");
        let pair = entries
            .iter()
            .find(|pair| pair[0].as_str() == Some(name))
            .unwrap_or_else(|| panic!("missing tagged field {name}"));
        &pair[1]
    }

    fn find_case_mut(mutated: &mut Value, predicate: impl Fn(&Value) -> bool + Copy) -> &mut Value {
        mutated["cases"]
            .as_array_mut()
            .expect("cases")
            .iter_mut()
            .find(|case| predicate(case))
            .expect("a case matching the predicate")
    }

    fn find_op_mut<'a>(mutated: &'a mut Value, method: &str) -> &'a mut Value {
        let cases = mutated["cases"].as_array_mut().expect("cases");
        for case in cases {
            let operations = case["operations"].as_array_mut().expect("operations");
            if let Some(index) = operations
                .iter()
                .position(|operation| operation["method"] == method)
            {
                return &mut operations[index];
            }
        }
        panic!("missing {method} operation")
    }

    fn declaration_input_mut(operation: &mut Value) -> &mut Value {
        tagged_field(&mut operation["declaration"], "input")
    }

    fn assert_rejected(client: &str, mutated: &Value) {
        if validate_body(mutated).is_ok() {
            panic!("{client}: mutated corpus must be rejected by the strict atomic reader");
        }
    }

    fn assert_accepted(client: &str, mutated: &Value) {
        if let Err(error) = validate_body(mutated) {
            panic!("{client}: expected the untouched shape to validate, got {error}");
        }
    }

    #[test]
    fn load_full_corpus() {
        let source = load().expect("frozen private-modules corpus loads");
        assert_eq!(source.cases.len(), 255, "the witness declares 255 cases");
        let operations: usize = source.cases.iter().map(|case| case.operations.len()).sum();
        assert_eq!(operations, 3259, "the witness declares 3259 operations");
        assert_eq!(source.maps.len(), 8, "the witness embeds 8 source maps");
        assert_eq!(source.catalog.card_ids.len(), 80, "all 80 source cards");
        assert_eq!(source.catalog.ability_ids.len(), 5, "all 5 source Wishes");
        let mut suites: BTreeMap<&str, usize> = BTreeMap::new();
        for case in &source.cases {
            *suites.entry(case.suite.as_str()).or_default() += 1;
        }
        for suite in SUITES {
            assert!(
                suites.get(suite).copied().unwrap_or(0) > 0,
                "suite {suite} must be present (a skipped suite is rejected)"
            );
        }
    }

    #[test]
    fn maps_validate_and_hashes_match() {
        let source = load().expect("frozen private-modules corpus loads");
        assert_eq!(source.maps.len(), 8);
        let mut fully_admitted = 0usize;
        let mut hand_arenas = 0usize;
        for map in &source.maps {
            // The embedded map hash is recomputed from the admitted source GameMap DTO for every declared map; the
            // reader already refused a mismatch, so this pins the recipe identity.
            let recomputed = u32::from_str_radix(&map_hash(&map.data), 16).expect("hex hash");
            assert_eq!(
                recomputed, map.map_hash_u32,
                "map {} hashes to its declared mapHashU32",
                map.id
            );
            assert_eq!(map.open.w, map.data.w);
            assert_eq!(map.open.h, map.data.h);
            assert_eq!(map.locked.w, map.data.w);
            assert_eq!(map.locked.h, map.data.h);
            assert_eq!(map.open.tiles.len(), (map.data.w * map.data.h) as usize);
            assert_eq!(
                map.terrain().len(),
                (map.data.w * map.data.h) as usize,
                "the declared terrain layer is exposed for every map"
            );
            assert_eq!(map.plan.camps.len(), map.data.camps.len());
            assert_eq!(map.plan.spawn_pool.len(), map.data.spawn_pool.len());
            if map.fully_admitted() {
                fully_admitted += 1;
                assert!(map.layers().is_some());
                assert!(map.open.layers().is_some());
                // The warped locked grid cannot re-admit the canonical gate tiles, so its collision map is layer-less
                // (source `withGates` shares metadata; the private module reads terrain from `terrain()`).
                assert!(map.locked.layers().is_none());
                // Source `withGates`: every declared gate tile becomes TILE_WALL in the locked collision map.
                for gate in &map.data.coliseum.gates {
                    for tile in &gate.tiles {
                        let index = tile.y as usize * map.open.w as usize + tile.x as usize;
                        assert_eq!(map.locked.tiles[index], rh_sim::map::TILE_WALL);
                        assert_ne!(map.open.tiles[index], rh_sim::map::TILE_WALL);
                    }
                }
            } else {
                hand_arenas += 1;
                assert!(source_hand_map(&map.data));
                assert!(map.layers().is_none());
            }
        }
        // One full generated map (mapgen.generateMap(7,...)) admits the complete layer DTO; the other seven are the
        // source builders' hand-built `mapFromTiles` arenas, which declare no coliseum/regions/camps metadata and
        // therefore cannot pass the full-layer admission. Their terrain is still exposed through `terrain()`.
        assert_eq!(
            fully_admitted, 1,
            "generated7 is the fully admitted source map"
        );
        assert_eq!(hand_arenas, 7, "seven maps are declared hand-built arenas");
        assert!(source
            .maps
            .iter()
            .any(|map| map.id == "generated7" && map.fully_admitted()));
    }

    #[test]
    fn strict_raw_duplicate_keys_rejected() {
        assert!(parse_raw(r#"{"format":1,"format":2}"#).is_err());
        assert!(parse_raw(r#"{"a":1,"\u0061":2}"#).is_err());
        assert!(parse_raw(r#"{"a":1,"\u0061":2,"nested":{"x":1,"x":2}}"#).is_err());
        assert!(parse_raw("{\"a\":1} trailing").is_err());
        assert!(parse_raw("{\"a\":1,}").is_err());
        // The untouched frozen corpus parses and converts atomically.
        let raw = body();
        assert_accepted("frozen corpus", &raw);
        assert_eq!(255, load().expect("load").cases.len());
    }

    #[test]
    fn strict_negatives_reject_mutated_body() {
        let original = body();
        {
            // Unknown cfg identity token.
            let mut mutated = original.clone();
            let operation = find_op_mut(&mut mutated, "observe");
            *tagged_field(&mut operation["declaration"], "cfg") = Value::String("absent".into());
            assert_rejected("unknown cfg token", &mutated);
        }
        {
            // Tagged +Infinity declared percept clock.
            let mut mutated = original.clone();
            let operation = find_op_mut(&mut mutated, "observe");
            *tagged_field(declaration_input_mut(operation), "now") =
                serde_json::json!({"$": "number", "value": "+Infinity"});
            assert_rejected("nonfinite percept clock", &mutated);
        }
        {
            // Tagged NaN view clock.
            let mut mutated = original.clone();
            let operation = find_op_mut(&mut mutated, "observe");
            *tagged_field(declaration_input_mut(operation), "viewT") =
                serde_json::json!({"$": "number", "value": "NaN"});
            assert_rejected("nan view clock", &mutated);
        }
        {
            // Missing source map label (cfg.map is a foreign key into body.maps).
            let mut mutated = original.clone();
            let case = find_case_mut(&mut mutated, |case| {
                case["configs"]["entries"]
                    .as_array()
                    .is_some_and(|entries| !entries.is_empty())
            });
            let token = case["configs"]["entries"][0][0]
                .as_str()
                .expect("cfg token")
                .to_string();
            let config = tagged_field(&mut case["configs"], &token);
            *tagged_field(config, "map") = Value::String("absent-map".into());
            assert_rejected("missing map label", &mutated);
        }
        {
            // Duplicate embedded source map id.
            let mut mutated = original.clone();
            let duplicate = mutated["maps"][1]["id"].clone();
            mutated["maps"][0]["id"] = duplicate;
            assert_rejected("duplicate map id", &mutated);
        }
        {
            // Unsupported suite.
            let mut mutated = original.clone();
            mutated["cases"][0]["suite"] = Value::String("future".into());
            assert_rejected("unsupported suite", &mutated);
        }
        {
            // Malformed hook name.
            let mut mutated = original.clone();
            let operation = find_op_mut(&mut mutated, "hook");
            *tagged_field(&mut operation["declaration"], "name") = Value::String("future".into());
            assert_rejected("malformed hook name", &mutated);
        }
        {
            // Tagged +Infinity independent Hunter clock.
            let mut mutated = original.clone();
            let operation = find_op_mut(&mut mutated, "hunter.decide");
            *tagged_field(declaration_input_mut(operation), "now") =
                serde_json::json!({"$": "number", "value": "+Infinity"});
            assert_rejected("nonfinite hunter clock", &mutated);
        }
        {
            // Nonfinite ordinary declared config numeric (only learned entries are exempt).
            let mut mutated = original.clone();
            let case = find_case_mut(&mut mutated, |case| {
                case["configs"]["entries"]
                    .as_array()
                    .is_some_and(|entries| !entries.is_empty())
            });
            let token = case["configs"]["entries"][0][0]
                .as_str()
                .expect("cfg token")
                .to_string();
            let config = tagged_field(&mut case["configs"], &token);
            *tagged_field(tagged_field(config, "tierValues"), "knowledge") =
                serde_json::json!({"$": "number", "value": "NaN"});
            assert_rejected("nonfinite config numeric", &mutated);
        }
        {
            // Backwards Memory observation clock within one cfg (this case interleaves two cfg tokens, so the two
            // observations of one token are not adjacent).
            let mut mutated = original.clone();
            let case_index = {
                let cases = mutated["cases"].as_array().expect("cases");
                cases
                    .iter()
                    .enumerate()
                    .find_map(|(case_index, case)| {
                        let mut seen: Vec<&str> = Vec::new();
                        for operation in case["operations"].as_array().expect("operations") {
                            if operation["method"] != "observe" {
                                continue;
                            }
                            let declaration = &operation["declaration"];
                            let cfg = tagged_field_ref(declaration, "cfg").as_str()?;
                            if seen.contains(&cfg) {
                                return Some(case_index);
                            }
                            seen.push(cfg);
                        }
                        None
                    })
                    .expect("a case that observes one cfg twice")
            };
            let (first_index, second_index) = {
                let cases = mutated["cases"].as_array().expect("cases");
                let operations = cases[case_index]["operations"]
                    .as_array()
                    .expect("operations");
                let mut observed: Vec<(usize, String)> = Vec::new();
                let mut pair = None;
                for (index, operation) in operations.iter().enumerate() {
                    if operation["method"] != "observe" {
                        continue;
                    }
                    let cfg = tagged_field_ref(&operation["declaration"], "cfg")
                        .as_str()
                        .expect("declared cfg token")
                        .to_string();
                    if let Some((first_index, _)) = observed.iter().find(|(_, seen)| *seen == cfg) {
                        pair = Some((*first_index, index));
                        break;
                    }
                    observed.push((index, cfg));
                }
                pair.expect("two observations of one cfg")
            };
            let first_now = {
                let cases = mutated["cases"].as_array().expect("cases");
                let operations = cases[case_index]["operations"]
                    .as_array()
                    .expect("operations");
                tagged_field_ref(
                    tagged_field_ref(&operations[first_index]["declaration"], "input"),
                    "now",
                )
                .as_f64()
                .expect("finite observation clock")
            };
            let cases = mutated["cases"].as_array_mut().expect("cases");
            let operations = cases[case_index]["operations"]
                .as_array_mut()
                .expect("operations");
            let second = &mut operations[second_index];
            *tagged_field(declaration_input_mut(second), "now") = Value::from(first_now - 1.);
            assert_rejected("backwards observation clock", &mutated);
        }
        {
            // Missing consumed percept fact (source self.readyAt).
            let mut mutated = original.clone();
            let operation = find_op_mut(&mut mutated, "observe");
            let perceptor = declaration_input_mut(operation);
            let entries = tagged_field(perceptor, "self")
                .get_mut("entries")
                .and_then(Value::as_array_mut)
                .expect("self entries");
            let before = entries.len();
            entries.retain(|pair| pair[0].as_str() != Some("readyAt"));
            assert!(entries.len() < before, "the self record declares readyAt");
            assert_rejected("missing consumed self fact", &mutated);
        }
        {
            // Unsupported source enum (percept self status).
            let mut mutated = original.clone();
            let operation = find_op_mut(&mut mutated, "observe");
            let self_record = tagged_field(declaration_input_mut(operation), "self");
            *tagged_field(self_record, "status") = Value::String("future".into());
            assert_rejected("unsupported status enum", &mutated);
        }
        {
            // A non-enabled hook before its cfg has been observed.
            let mut mutated = original.clone();
            let cases = mutated["cases"].as_array_mut().expect("cases");
            let case = cases
                .iter_mut()
                .find(|case| {
                    case["operations"]
                        .as_array()
                        .expect("operations")
                        .iter()
                        .any(|operation| operation["method"] == "hook")
                })
                .expect("a hook case");
            let operations = case["operations"].as_array_mut().expect("operations");
            let observe_index = operations
                .iter()
                .position(|operation| operation["method"] == "observe");
            if let Some(observe_index) = observe_index {
                operations.remove(observe_index);
            }
            assert_rejected("hook before observe", &mutated);
        }
    }

    #[test]
    fn positive_case_per_suite() {
        let source = load().expect("frozen private-modules corpus loads");
        for suite in SUITES {
            let case = source
                .cases
                .iter()
                .find(|case| case.suite.as_str() == suite)
                .unwrap_or_else(|| panic!("suite {suite} is present"));
            assert!(!case.covers.is_empty());
            assert!(!case.operations.is_empty());
            assert_eq!(case.suite.as_str(), suite);
            for operation in &case.operations {
                let declared = match &operation.declaration {
                    Declaration::Observe { .. } => "observe",
                    Declaration::NoteSent { .. } => "noteSent",
                    Declaration::RecordChoice { .. } => "recordChoice",
                    Declaration::Hook { .. } => "hook",
                    Declaration::Helper { .. } => "helper",
                    Declaration::HunterDecide { .. } => "hunter.decide",
                    Declaration::HunterMarkDone { .. } => "hunter.markDone",
                    Declaration::HunterTried { .. } => "hunter.tried",
                    Declaration::HunterInspect => "hunter.inspect",
                    Declaration::RegistryReset => "registry.reset",
                    Declaration::RegistryDefaults => "registry.defaults",
                    Declaration::RegistryRegister(_) => "registry.register",
                    Declaration::RegistryEnabled { .. } => "registry.enabled",
                    Declaration::RegistryPolicySet => "registry.policySet",
                    Declaration::RegistryPolicyGet => "registry.policyGet",
                };
                assert_eq!(declared, operation.method.as_str());
            }
            // Every observe case carries both the module percept and the admitted Memory percept row, and the typed
            // module facts agree with the declared clocks.
            for operation in &case.operations {
                if let Declaration::Observe {
                    percept,
                    memory_percept,
                    ..
                } = &operation.declaration
                {
                    assert_eq!(percept.now, memory_percept.now);
                    assert_eq!(percept.view_t, memory_percept.view_t);
                    assert!(percept.now.is_finite());
                    assert!(percept.view_t.is_finite());
                    assert_eq!(percept.self_.id, memory_percept.self_.id);
                }
            }
        }
    }
}
