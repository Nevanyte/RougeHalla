//! P-BOT-VISION source parity scaffolding.
//!
//! `declared_inputs_are_consumable` is NOT parity: it proves only that every declared update
//! input and Percept in `parity/policy/bot-vision/declared-inputs.json` reads through the
//! private adapter, and that native refuses exactly where the declared case expects the source
//! to throw. No output is compared because no actual source output exists yet.
//!
//! `actual_source_parity` consumes the future Root-reviewed actual capture
//! (`parity/policy/bot-vision/source.json`, raw `rh-bot-vision-source/1`). It is ignored until
//! that capture is admitted; it binds every recorded input to the declared inputs, then compares
//! every diagnostic, canSee answer, filter probe and filtered Percept bit for bit and reports the
//! first discrepancy. Nothing from the capture is installed into the native component.
use super::adapter::{
    declared_cases, replay, repo_path, seed1, Case, Step, DECLARED_PATH, SOURCE_PATH,
};
use serde_json::Value;

/// Pinned at Root admission of the first actual capture (byte length of source.json).
const SOURCE_BYTES: Option<u64> = None;

fn declared() -> Value {
    let text = std::fs::read_to_string(repo_path(DECLARED_PATH)).expect("declared inputs");
    serde_json::from_str(&text).expect("declared inputs JSON")
}

#[test]
fn declared_inputs_are_consumable() {
    let cases = declared_cases(&declared());
    assert_eq!(cases.len(), 12, "declared case count");
    let steps: usize = cases.iter().map(|c| c.steps.len()).sum();
    assert_eq!(steps, 104, "declared step count");
    assert_eq!(
        cases.iter().filter(|c| c.expect_throw).count(),
        4,
        "declared source-throw cases"
    );
    replay(&seed1(), &cases)
        .expect("every declared input is consumable; refusals only at declared throws");
}

#[test]
#[ignore = "awaits the Root-reviewed first actual source capture (docs/evidence/bot-vision/CAPTURE-REQUEST.md)"]
fn actual_source_parity() {
    let path = repo_path(SOURCE_PATH);
    let meta = std::fs::metadata(&path).expect("actual capture not yet admitted");
    if let Some(bytes) = SOURCE_BYTES {
        assert_eq!(meta.len(), bytes, "pinned capture byte length");
    }
    let raw: Value =
        serde_json::from_reader(std::fs::File::open(&path).unwrap()).expect("capture JSON");
    assert_eq!(raw["format"], "rh-bot-vision-source/1");
    assert_eq!(raw["codec"], "rh-vision-value/1");
    assert_eq!(raw["map"]["path"], super::adapter::MAP_PATH);
    let declared = declared_cases(&declared());
    let raw_cases = raw["cases"].as_array().expect("cases");
    assert_eq!(raw_cases.len(), declared.len(), "case count");
    let mut cases = Vec::new();
    let mut total = 0;
    for (want, got) in declared.iter().zip(raw_cases) {
        assert_eq!(got["id"], want.id.as_str());
        let steps = got["steps"].as_array().expect("steps");
        assert_eq!(
            steps.len(),
            want.steps.len(),
            "{}: every declared step recorded",
            want.id
        );
        let mut out = Vec::new();
        for (i, (d, s)) in want.steps.iter().zip(steps).enumerate() {
            assert_eq!(s["op"], d.op.as_str(), "{}[{i}] op", want.id);
            let input = (d.op != "canSee").then(|| s["input"].clone());
            assert_eq!(
                input, d.input,
                "{}[{i}]: recorded input is exactly the declared input",
                want.id
            );
            if d.op == "canSee" {
                assert_eq!(
                    Some(&s["points"]),
                    d.points.as_ref(),
                    "{}[{i}] points",
                    want.id
                );
            }
            if d.op == "update" {
                assert_eq!(s["selfId"].as_str(), d.self_id.as_deref());
            }
            total += 1;
            out.push(Step {
                op: d.op.clone(),
                input: d.input.clone(),
                self_id: d.self_id.clone(),
                points: d.points.clone(),
                actual: Some(s.clone()),
            });
        }
        cases.push(Case {
            id: want.id.clone(),
            expect_throw: want.expect_throw,
            steps: out,
        });
    }
    let compared = replay(&seed1(), &cases)
        .unwrap_or_else(|first| panic!("first parity discrepancy: {first}"));
    assert_eq!(compared, total, "every recorded step compared");
}
