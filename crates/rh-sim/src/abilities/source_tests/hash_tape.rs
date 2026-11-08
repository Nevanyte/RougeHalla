//! Derived native hash regression tape for the composed candidate layout named by its recorded identities.
//! Legacy source outputs remain frozen; all58 admitted cases must execute before recording or checking.
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
        if PENDING_SOURCE_CASES
            .iter()
            .any(|(pending, _, _)| *pending == name)
        {
            continue;
        }
        let mut fold = 0xcbf2_9ce4_8422_2325u64;
        let mut ticks = 0u64;
        run_case_watch(case, &mut |s| {
            fold = (fold ^ s.state_hash()).wrapping_mul(0x0000_0100_0000_01b3);
            ticks += 1;
        });
        out.insert(
            name,
            json!({"fold": format!("{fold:016x}"), "ticks": ticks}),
        );
    }
    assert_eq!(
        out.len(),
        58,
        "all admitted source cases must produce a hash tape"
    );
    out
}

#[test]
fn ability_hash_tape_matches_the_base() {
    let tape: V = serde_json::from_str(
        &std::fs::read_to_string(tape_path()).expect("parity/abilities/hash-tape.json"),
    )
    .unwrap();
    assert_eq!(tape["format"], "rh-ability-hash-tape/2");
    assert_eq!(tape["base"], "optimization_port-union-2026-11-08");
    assert_eq!(tape["checkpoint"], crate::checkpoint::CHECKPOINT_FORMAT);
    assert_eq!(
        tape["contentHash"],
        format!("{:016x}", crate::content::content_hash())
    );
    assert_eq!(tape["observationVersion"], crate::OBSERVATION_VERSION);
    let want = tape["cases"].as_object().unwrap();
    let got = digests();
    for (name, value) in &got {
        assert_eq!(want.get(name), Some(value), "hash tape case {name}");
    }
    assert_eq!(want.len(), got.len(), "hash tape case set");
}

/// Records native digests after the coordinator changes a canonical layout, following actual source comparisons.
#[test]
#[ignore = "records the base hash tape"]
fn record_ability_hash_tape() {
    let cases = digests();
    let tape = json!({
        "format": "rh-ability-hash-tape/2",
        "base": "optimization_port-union-2026-11-08",
        "checkpoint": crate::checkpoint::CHECKPOINT_FORMAT,
        "contentHash": format!("{:016x}", crate::content::content_hash()),
        "observationVersion": crate::OBSERVATION_VERSION,
        "note": "58 admitted source cases executed without catch-and-drop; native digests rebound for the combined layout, not legacy expected gameplay",
        "cases": cases,
    });
    std::fs::write(tape_path(), serde_json::to_string_pretty(&tape).unwrap()).unwrap();
}
