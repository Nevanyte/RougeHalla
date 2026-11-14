//! P-FROST-WALL-2a oracle (owner decision 2026-11-12: the wall's numbers enter content in P-FROST-WALL-2; this is
//! its first part): every number Frost Wall plays with is a named row of the content registry, appended at its end,
//! so `content_hash` moves once, here, to one known value, and every pinned copy of it moves with it. No number
//! changes value; only where it is declared.
//!
//! The ONE place the implementer writes the new value is `GOLDEN_CONTENT_HASH` in `crates/rh-sim/tests/content.rs`
//! (its `hash_golden` test checks it against `content_hash()`). Every other copy is checked against that value here:
//! the ability hash tape's `contentHash`, `protocol/fixtures/archetypes_v1.json`'s `contentHash`, and the two browser
//! reload-proof scripts. The tape and the archetype golden may change in that one field only (their other content is
//! pinned below by digest), and no source, test, script or golden vector may still name the pre-wall value.
//! (Lifted from the draft on `oracle-draft/P-FROST-WALL-2-content` @ 465426198, written for P-FROST-WALL-1c.)
use rh_sim::constants::{ContentVal, REGISTRY};
use rh_sim::content::content_hash;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// The content hash before the wall's numbers entered the registry (feature/unity-rework at aadff95e3).
const PRE_WALL_CONTENT_HASH: u64 = 0x4674_a176_a28e_3c7a;

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn read(relative: &str) -> String {
    let p = repo().join(relative);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

fn hex(h: u64) -> String {
    format!("{h:016x}")
}

/// The wall's numbers (legacy 78dd8bd4: `shared/src/abilities.ts` and `constants.ts` for the cast, `shared/src/barriers.ts`
/// for the tiles, `server/src/sim/abilities.ts:532-533,585` for the push-out), as (registry name, value).
fn wall_numbers() -> Vec<(&'static str, f64)> {
    vec![
        ("FROST_WALL_RANGE", 450.),
        ("FROST_WALL_MIN_RANGE", 64.),
        ("FROST_WALL_LENGTH", 224.),
        ("FROST_WALL_MS", 4000.),
        ("FROST_WALL_CAST_MS", 250.),
        ("FROST_WALL_COOLDOWN_MS", 45000.),
        // TILE * 0.75 and TILE / 4.
        ("WALL_CELL_REACH", 24.),
        ("WALL_END_SLACK", 8.),
        // Legacy `WALL_PUSH_STEP`, `WALL_PUSH_MAX`, and the gap's `PLAYER_RADIUS + 32`.
        ("WALL_PUSH_STEP", 4.),
        ("WALL_PUSH_MAX", 96.),
        ("WALL_GAP_REACH", 44.),
    ]
}

#[test]
fn every_frost_wall_number_is_a_named_registry_row() {
    let mut missing = Vec::new();
    for (name, want) in wall_numbers() {
        match REGISTRY.iter().find(|e| e.name == name) {
            None => missing.push(name.to_string()),
            Some(e) => assert_eq!(
                e.val,
                ContentVal::F64(want),
                "{name} is registered with legacy's value"
            ),
        }
    }
    assert!(
        missing.is_empty(),
        "Frost Wall numbers not in the content! registry (crates/rh-sim/src/constants.rs): {missing:?}"
    );
}

/// The registry's own rule (`constants.rs` module docs): "Declaration order is part of the hash: append new rows, do
/// not shuffle." The eleven rows are the last eleven, in the order of `wall_numbers`, and no other row moved.
#[test]
fn the_wall_rows_are_appended_at_the_end_of_the_registry_in_order() {
    let names: Vec<&str> = REGISTRY.iter().map(|e| e.name).collect();
    let want: Vec<&str> = wall_numbers().iter().map(|(n, _)| *n).collect();
    let tail = &names[names.len().saturating_sub(want.len())..];
    assert_eq!(
        tail,
        &want[..],
        "the Frost Wall rows are appended after CAMP_BUFF_REPAIR_STEPS, in this order"
    );
    assert_eq!(
        names[names.len() - want.len() - 1],
        "CAMP_BUFF_REPAIR_STEPS",
        "the rows before the wall's are today's, unshuffled"
    );
}

/// The value `content_hash` takes with the eleven rows appended as above and nothing else changed (computed by the
/// oracle author on 47a886495 with a trial implementation; see the brief, "Baseline").
const WALL_CONTENT_HASH: u64 = 0x7a54_2a13_187f_034c;

#[test]
fn the_content_hash_is_the_value_of_the_appended_rows() {
    assert_eq!(
        hex(content_hash()),
        hex(WALL_CONTENT_HASH),
        "content_hash with the eleven wall rows appended (and nothing else in content changed)"
    );
}

#[test]
fn the_push_out_reads_its_named_numbers_not_literals() {
    // Code only: the module comment above `set_down` already names legacy's `WALL_PUSH_STEP`/`WALL_PUSH_MAX`.
    let code: String = read("crates/rh-sim/src/barriers.rs")
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    for name in ["WALL_PUSH_STEP", "WALL_PUSH_MAX", "WALL_GAP_REACH"] {
        assert!(code.contains(name), "barriers.rs code does not read {name}");
    }
    for literal in ["(4., 96.)", "PLAYER_RADIUS + 32", "96."] {
        assert!(
            !code.contains(literal),
            "barriers.rs still plays with the literal {literal}"
        );
    }
}

#[test]
fn the_content_hash_moved_off_the_pre_wall_value() {
    assert_ne!(
        content_hash(),
        PRE_WALL_CONTENT_HASH,
        "the wall's numbers are not folded into content_hash"
    );
}

/// `GOLDEN_CONTENT_HASH` as written in `crates/rh-sim/tests/content.rs`.
fn golden() -> u64 {
    let code = read("crates/rh-sim/tests/content.rs");
    let line = code
        .lines()
        .find(|l| {
            l.trim_start()
                .starts_with("const GOLDEN_CONTENT_HASH: u64 =")
        })
        .expect("tests/content.rs declares GOLDEN_CONTENT_HASH");
    let v = line
        .split('=')
        .nth(1)
        .unwrap()
        .trim()
        .trim_end_matches(';')
        .trim()
        .trim_start_matches("0x")
        .replace('_', "");
    u64::from_str_radix(&v, 16).expect("GOLDEN_CONTENT_HASH is a hex literal")
}

/// The single-quoted string bound to `name` in a JS file (`const NAME = '...'` or `export const NAME = '...'`).
fn js_string(relative: &str, name: &str) -> String {
    let code = read(relative);
    let line = code
        .lines()
        .find(|l| {
            let l = l.trim_start().trim_start_matches("export ");
            l.starts_with(&format!("const {name} = "))
        })
        .unwrap_or_else(|| panic!("{relative} declares {name}"));
    line.split('\'')
        .nth(1)
        .unwrap_or_else(|| panic!("{relative}: {name} is a quoted string"))
        .to_string()
}

fn json(relative: &str) -> Value {
    serde_json::from_str(&read(relative)).unwrap_or_else(|e| panic!("{relative}: {e}"))
}

#[test]
fn every_pinned_copy_of_the_content_hash_names_the_golden_value() {
    let golden = golden();
    assert_eq!(
        content_hash(),
        golden,
        "GOLDEN_CONTENT_HASH (tests/content.rs) is the one pinned value: content_hash is now {}",
        hex(content_hash())
    );
    let want = hex(golden);
    let copies = [
        (
            "parity/abilities/hash-tape.json contentHash",
            json("parity/abilities/hash-tape.json")["contentHash"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
        ),
        (
            "protocol/fixtures/archetypes_v1.json contentHash",
            json("protocol/fixtures/archetypes_v1.json")["contentHash"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
        ),
        (
            "tools/unity-browser-reload-proof/check.mjs CONTENT",
            js_string("tools/unity-browser-reload-proof/check.mjs", "CONTENT"),
        ),
        (
            "tools/unity-browser-reload-proof/normal-companion.mjs EXPECTED_CONTENT_HASH",
            js_string(
                "tools/unity-browser-reload-proof/normal-companion.mjs",
                "EXPECTED_CONTENT_HASH",
            ),
        ),
    ];
    for (place, got) in copies {
        assert_eq!(got, want, "{place} is not the golden content hash");
    }
}

/// A key-sorted serialization (independent of serde_json's `preserve_order`), FNV-1a 64 folded.
fn digest(v: &Value) -> u64 {
    fn canon(v: &Value, out: &mut String) {
        match v {
            Value::Object(m) => {
                let mut keys: Vec<&String> = m.keys().collect();
                keys.sort();
                out.push('{');
                for k in keys {
                    out.push_str(&serde_json::to_string(k).unwrap());
                    out.push(':');
                    canon(&m[k], out);
                    out.push(',');
                }
                out.push('}');
            }
            Value::Array(a) => {
                out.push('[');
                for x in a {
                    canon(x, out);
                    out.push(',');
                }
                out.push(']');
            }
            other => out.push_str(&serde_json::to_string(other).unwrap()),
        }
    }
    let mut s = String::new();
    canon(v, &mut s);
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    for b in s.bytes() {
        h = (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

fn without_content_hash(relative: &str) -> Value {
    let mut v = json(relative);
    v.as_object_mut()
        .unwrap_or_else(|| panic!("{relative} is an object"))
        .remove("contentHash")
        .unwrap_or_else(|| panic!("{relative} has a contentHash"));
    v
}

/// The carry moves `contentHash` and nothing else: re-recording the tape must not move a single case fold or tick
/// (the switch is off in every case), and the archetype golden's table is untouched.
#[test]
fn the_carry_changes_only_the_content_hash_field_of_the_tape_and_the_archetype_golden() {
    // The tape digest pin proved the content packet changed nothing in the tape but the content hash; retired on
    // 2026-11-14 at the wire merge (the tape moves with every observation version): `ability_hash_tape_matches_the_base` guards it.
    let archetypes = without_content_hash("protocol/fixtures/archetypes_v1.json");
    assert_eq!(
        hex(digest(&archetypes)),
        "7626003ed67bd3d7",
        "protocol/fixtures/archetypes_v1.json changed beyond contentHash"
    );
}

/// Every text file under these roots is a place a stale copy would hide (sources, tests, scripts, golden vectors).
fn scan_roots() -> Vec<&'static str> {
    vec![
        "crates",
        "tools",
        "protocol",
        "parity/abilities",
        "client-unity/RoguehallaNet",
        "client-unity/RoguehallaNet.Tests",
        "client-unity/RoguehallaNet.Probe",
        "client-unity/UnityProject/Assets/Scripts",
        "client-unity/UnityProject/Assets/Tests",
        "client-unity/UnityProject/Tools",
    ]
}

fn scan(dir: &Path, hits: &mut Vec<String>, needles: &[String], me: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if p.is_dir() {
            if ["target", "node_modules", "bin", "obj", "Library", ".git"].contains(&name.as_str())
            {
                continue;
            }
            scan(&p, hits, needles, me);
            continue;
        }
        let text_kind = [
            ".rs", ".json", ".mjs", ".js", ".cjs", ".cs", ".ts", ".toml", ".sh", ".html",
        ]
        .iter()
        .any(|x| name.ends_with(x));
        if !text_kind || p.canonicalize().ok().as_deref() == Some(me) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&p) else {
            continue;
        };
        let lower = text.to_ascii_lowercase();
        if needles.iter().any(|n| lower.contains(n.as_str())) {
            hits.push(p.strip_prefix(repo()).unwrap_or(&p).display().to_string());
        }
    }
}

#[test]
fn no_source_script_or_golden_still_names_the_pre_wall_content_hash() {
    let old = hex(PRE_WALL_CONTENT_HASH);
    let needles = vec![
        old.clone(),
        format!(
            "{}_{}_{}_{}",
            &old[0..4],
            &old[4..8],
            &old[8..12],
            &old[12..16]
        ),
        PRE_WALL_CONTENT_HASH.to_string(),
    ];
    let me = Path::new(file!())
        .canonicalize()
        .or_else(|_| repo().join(file!()).canonicalize())
        .or_else(|_| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/frost_wall_content.rs")
                .canonicalize()
        })
        .expect("this file");
    let mut hits = Vec::new();
    for root in scan_roots() {
        scan(&repo().join(root), &mut hits, &needles, &me);
    }
    assert!(
        hits.is_empty(),
        "files still naming the pre-wall content hash {old}: {hits:#?}"
    );
}
