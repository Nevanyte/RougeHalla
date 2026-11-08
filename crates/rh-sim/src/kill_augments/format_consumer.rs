//! Native consumer of the additive P-TROPHY-NATIVE-CONSUMER-1 actual-source formatting corpus
//! ('parity/trophy-format/format.json'): every row is an actual shared-helper output. The native side compares
//! js_to_fixed/encode/parse/text (and the exact binary64 tie neighbours) for all nine keys, flat and percentage wording,
//! tiny gains and parse/refusal boundaries. These are declared formatting inputs, not runtime lifecycle state.
use crate::kill_augments::KillAugment;
use crate::kill_augments::{self, KillStatKey};

const CORPUS: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../parity/trophy-format/format.json"
);

fn corpus() -> serde_json::Value {
    serde_json::from_str(&std::fs::read_to_string(CORPUS).expect("admitted format corpus"))
        .expect("format corpus json")
}

fn num(v: &serde_json::Value) -> f64 {
    v.as_f64().expect("a JSON number")
}

fn check(cond: bool, msg: impl FnOnce() -> String) -> Result<(), String> {
    if cond {
        Ok(())
    } else {
        Err(msg())
    }
}

fn key_of(v: &serde_json::Value) -> KillStatKey {
    KillStatKey::parse(v.as_str().expect("key")).expect("declared key")
}

fn bits_of(raw: f64, recorded: &serde_json::Value) -> Result<u64, String> {
    let text = recorded.as_str().expect("recorded bits");
    let bits = u64::from_str_radix(text.trim_start_matches("0x"), 16)
        .map_err(|e| format!("bad bits {text}: {e}"))?;
    check(bits == raw.to_bits(), || {
        format!("bits {text} != raw.to_bits() {:#018x}", raw.to_bits())
    })?;
    Ok(bits)
}

fn digits_for(path: &str) -> usize {
    match path {
        "flat-1dp" | "percentage-text-1dp" => 1,
        "percentage-4dp" => 4,
        other => panic!("unknown formatting path {other}"),
    }
}

fn compare_parsed(
    got: Option<KillAugment>,
    want: &serde_json::Value,
    ctx: &str,
) -> Result<(), String> {
    if want.is_null() {
        check(got.is_none(), || format!("{ctx}: parse {got:?} != null"))?;
        return Ok(());
    }
    let got = got.ok_or_else(|| format!("{ctx}: parse refused {want}"))?;
    let want_key = key_of(&want["key"]);
    check(
        got.key == want_key && got.gain == num(&want["gain"]),
        || format!("{ctx}: parse {got:?} != {want}"),
    )
}

fn compare_text(a: KillAugment, want: &serde_json::Value, ctx: &str) -> Result<(), String> {
    let (title, text) = kill_augments::text(a);
    check(title == want["title"].as_str().unwrap(), || {
        format!("{ctx}: text title {title:?} != {}", want["title"])
    })?;
    check(text == want["text"].as_str().unwrap(), || {
        format!("{ctx}: text body {text:?} != {}", want["text"])
    })
}

/// One actual-source formatting row against the native helper path.
fn compare_row(key: KillStatKey, path: &str, row: &serde_json::Value) -> Result<(), String> {
    let ctx = format!("{} {path} raw {}", key.as_str(), row["raw"]);
    let raw = num(&row["raw"]);
    let _bits = bits_of(raw, &row["bits"])?;
    let digits = digits_for(path);
    let fixed_input = if path == "percentage-text-1dp" {
        raw * 100.
    } else {
        raw
    };
    let fixed = kill_augments::js_to_fixed(fixed_input, digits as u32);
    check(fixed == row["fixed"].as_str().unwrap(), || {
        format!("{ctx}: fixed {fixed} != {}", row["fixed"])
    })?;
    let encoded = kill_augments::encode(KillAugment { key, gain: raw });
    check(encoded == row["encoded"].as_str().unwrap(), || {
        format!("{ctx}: encoded {encoded} != {}", row["encoded"])
    })?;
    let parsed = kill_augments::parse(&encoded);
    compare_parsed(parsed, &row["parsed"], &ctx)?;
    match (parsed, row["text"].is_null()) {
        (Some(a), false) => compare_text(a, &row["text"], &ctx)?,
        (None, true) => {}
        (got, want_null) => {
            return Err(format!(
                "{ctx}: parsed/text disagreement {got:?} (text null = {want_null})"
            ))
        }
    }
    Ok(())
}

fn compare_keys(doc: &serde_json::Value) -> Result<(), String> {
    let keys = doc["cases"]["keys"].as_array().expect("keys");
    check(keys.len() == 9, || "nine key rows".into())?;
    let mut seen = Vec::new();
    for row in keys {
        let key = key_of(&row["key"]);
        seen.push(key);
        compare_row(key, row["path"].as_str().unwrap(), row)?;
    }
    check(seen == KillStatKey::ALL.to_vec(), || {
        format!("key order {seen:?} != ALL")
    })
}

fn compare_ties(doc: &serde_json::Value) -> Result<(), String> {
    let ties = doc["cases"]["ties"].as_array().expect("ties");
    check(ties.len() == 28, || format!("tie groups {}", ties.len()))?;
    for group in ties {
        let key = key_of(&group["key"]);
        let path = group["kind"].as_str().unwrap();
        let value = num(&group["tie"]);
        let value_bits = bits_of(value, &group["tieBits"])?;
        let rows = &group["rows"];
        // The neighbours are exactly nextDown/nextUp of the recorded tie (positive values).
        let prev = num(&rows["prev"]["raw"]);
        let next = num(&rows["next"]["raw"]);
        check(prev.to_bits() + 1 == value_bits, || {
            format!("{} {path} prev is not nextDown", key.as_str())
        })?;
        check(value_bits + 1 == next.to_bits(), || {
            format!("{} {path} next is not nextUp", key.as_str())
        })?;
        for (name, row) in [
            ("prev", &rows["prev"]),
            ("at", &rows["at"]),
            ("next", &rows["next"]),
        ] {
            compare_row(key, path, row)
                .map_err(|e| format!("tie {} {path} {name}: {e}", key.as_str()))?;
        }
    }
    Ok(())
}

fn compare_tiny(doc: &serde_json::Value) -> Result<(), String> {
    let tiny = doc["cases"]["tiny"].as_array().expect("tiny");
    check(tiny.len() == 9, || "nine tiny rows".into())?;
    for group in tiny {
        let key = key_of(&group["key"]);
        let path = if key.flat() {
            "flat-1dp"
        } else {
            "percentage-4dp"
        };
        for row in group["rows"].as_array().unwrap() {
            compare_row(key, path, row).map_err(|e| format!("tiny {}: {e}", key.as_str()))?;
        }
    }
    Ok(())
}

fn compare_refusals(doc: &serde_json::Value) -> Result<(), String> {
    for row in doc["cases"]["refusals"].as_array().expect("refusals") {
        let id = row["id"].as_str().unwrap();
        let got = kill_augments::parse(id);
        compare_parsed(got, &row["parsed"], &format!("refusal {id:?}"))?;
    }
    Ok(())
}

/// Captured source roll rows: the corpus stores the ACTUAL `rollKillAugments` outputs; this consumer only parses,
/// re-encodes and re-words those captured ids natively. It is NOT a native roll() reproduction (native ranking/ties are
/// covered by helper_consumer's ranking-ties-truncation case) and makes no source-arithmetic claim.
fn compare_rolls(doc: &serde_json::Value) -> Result<(), String> {
    for case in doc["cases"]["rolls"].as_array().expect("rolls") {
        let options = case["options"].as_array().unwrap();
        let parsed = case["parsed"].as_array().unwrap();
        let texts = case["text"].as_array().unwrap();
        for ((id, want_parsed), want_text) in options.iter().zip(parsed).zip(texts) {
            let id = id.as_str().unwrap();
            let a = kill_augments::parse(id).expect("roll option parses");
            compare_parsed(Some(a), want_parsed, &format!("roll {id}"))?;
            check(kill_augments::encode(a) == id, || {
                format!("roll {id}: native encode {}", kill_augments::encode(a))
            })?;
            if !want_text.is_null() {
                compare_text(a, want_text, &format!("roll {id}"))?;
            }
        }
    }
    Ok(())
}

fn compare_all(doc: &serde_json::Value) -> Result<(), String> {
    check(doc["format"] == "rh-trophy-format-source/1", || {
        "format corpus tag".into()
    })?;
    check(
        doc["evidence"]
            .as_str()
            .unwrap()
            .contains("NOT runtime lifecycle state"),
        || "format corpus evidence label".into(),
    )?;
    compare_keys(doc)?;
    compare_ties(doc)?;
    compare_tiny(doc)?;
    compare_refusals(doc)?;
    compare_rolls(doc)?;
    Ok(())
}

#[test]
fn actual_source_format_ties_and_adjacent_values_match_natively() {
    let doc = corpus();
    compare_all(&doc).unwrap_or_else(|e| panic!("format consumer: {e}"));
}

/// Compiled semantic control: a provenance-only mutation is not a kill; a rounding, wording or binary64-bit mutation is.
#[test]
fn format_semantic_controls_require_an_output_difference() {
    let doc = corpus();
    compare_all(&doc).expect("baseline format corpus passes");
    // Provenance-only: changing a recorded tool/source hash must not count as a kill.
    let mut provenance_only = doc.clone();
    provenance_only["provenance"]["sourceClosure"]["digest"] =
        serde_json::json!("0000000000000000000000000000000000000000000000000000000000000000");
    provenance_only["provenance"]["tools"]["captureMts"] =
        serde_json::json!("1111111111111111111111111111111111111111111111111111111111111111");
    compare_all(&provenance_only).expect("provenance-only mutation is not a semantic kill");
    // Wrong 1-decimal rounding in a flat tie neighbour.
    let mut rounding = doc.clone();
    rounding["cases"]["ties"][0]["rows"]["at"]["fixed"] = serde_json::json!("0.2");
    let err = compare_all(&rounding).expect_err("wrong fixed output must be reported");
    assert!(err.contains("fixed"), "{err}");
    // Wrong binary64 neighbour bits.
    let mut bits = doc.clone();
    bits["cases"]["ties"][0]["rows"]["prev"]["bits"] = serde_json::json!("0x0000000000000000");
    let err = compare_all(&bits).expect_err("wrong bits must be reported");
    assert!(err.contains("bits"), "{err}");
    // Wrong wording.
    let mut wording = doc.clone();
    wording["cases"]["keys"][0]["text"]["title"] = serde_json::json!("+3.2 Offense");
    let err = compare_all(&wording).expect_err("wrong text title must be reported");
    assert!(err.contains("text title"), "{err}");
    // Wrong encoded id.
    let mut encoded = doc.clone();
    encoded["cases"]["keys"][0]["encoded"] = serde_json::json!("kill:ad:3.2");
    let err = compare_all(&encoded).expect_err("wrong encoded id must be reported");
    assert!(err.contains("encoded"), "{err}");
    // Restore the control: the unchanged corpus passes again.
    compare_all(&doc).expect("restored format corpus passes");
}
