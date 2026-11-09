//! The immutable two-case source contract. The ordinary-input native driver and phase comparator are added alongside
//! the connected source/fold hooks; these shape checks alone are not native parity.
use serde_json::Value;
fn corpus() -> Value {
    serde_json::from_str(include_str!("../../../../../../parity/mark-tax-uncapped/source.json")).unwrap()
}
#[test]
fn released_contract_retains_both_complete_timelines_and_old_row_transition() {
    let f = corpus();
    assert_eq!(f["format"], "rh-mark-tax-uncapped-source/1");
    let cases = f["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 2);
    assert_eq!(cases.iter().map(|c| c["frames"].as_array().unwrap().len()).sum::<usize>(), 124);
    assert_eq!(cases[0]["frames"][48]["value"]["player"]["markTax"], 48);
    assert_eq!(cases[0]["frames"][61]["phases"][2]["value"]["player"]["asMult"], 524);
    assert_eq!(cases[0]["frames"][61]["value"]["player"]["asMult"], 1010);
}
