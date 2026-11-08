//! P-CONTENT-1: the per-tick state-hash tape for every admitted ability source case, recorded at the base revision.
//! The tape is generated once, at the base, with `--ignored record_ability_hash_tape`; the packet's branch must reproduce it.
//! P-FACTION-2 re-records it on the packet branch: the serialized world layout moved (`rh-checkpoint/20` -> `/21`) for the
//! Fire roam state, so every state digest changes by construction (the cases' tick counts are unchanged).
use super::*;
use serde_json::{json, Map, Value as V};

fn tape_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/abilities/hash-tape.json")
}

fn digests() -> Map<String, V> {
    let corpus = corpus();
    let mut out = Map::new();
    for case in corpus["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap().to_string();
        let mut fold = 0xcbf2_9ce4_8422_2325u64;
        let mut ticks = 0u64;
        let ok = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_case_watch(case, &mut |s| {
                fold = (fold ^ s.state_hash()).wrapping_mul(0x0000_0100_0000_01b3);
                ticks += 1;
            });
        }))
        .is_ok();
        if ok {
            out.insert(
                name,
                json!({"fold": format!("{fold:016x}"), "ticks": ticks}),
            );
        }
    }
    out
}

#[test]
fn ability_hash_tape_matches_the_base() {
    let tape: V = serde_json::from_str(
        &std::fs::read_to_string(tape_path()).expect("parity/abilities/hash-tape.json"),
    )
    .unwrap();
    assert_eq!(tape["format"], "rh-ability-hash-tape/1");
    assert_eq!(tape["base"], "039ceb47");
    let want = tape["cases"].as_object().unwrap();
    let got = digests();
    for (name, value) in &got {
        assert_eq!(want.get(name), Some(value), "hash tape case {name}");
    }
    assert_eq!(want.len(), got.len(), "hash tape case set");
}

/// Records the tape at the base revision. Normally run with `--ignored` in a base worktree; a packet whose serialized
/// world layout moves re-records it on its branch and documents the move in its evidence (P-FACTION-2: checkpoint/21).
#[test]
#[ignore = "records the base hash tape"]
fn record_ability_hash_tape() {
    let cases = digests();
    let tape = json!({
        "format": "rh-ability-hash-tape/1",
        "base": "039ceb47",
        "note": "per-tick state hashes of every admitted ability source case, folded FNV-style; re-recorded for the P-FACTION-2 checkpoint/21 layout move",
        "cases": cases,
    });
    std::fs::write(tape_path(), serde_json::to_string_pretty(&tape).unwrap()).unwrap();
}
