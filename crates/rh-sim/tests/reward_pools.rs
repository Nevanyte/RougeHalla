//! P-CARDS-1: the source reward pools and the exact tiered draw protocol against the 409-case corpus.
use rh_sim::cards::{Build, CardId};
use rh_sim::reward_chests::{augment_pool, conditional_pool, roll_with, zone_theme, INTERACTIVE};
use rh_sim::FactionId;
use serde_json::Value as V;

fn corpus() -> V {
    serde_json::from_str(include_str!("../../../parity/card-catalog/source.json")).unwrap()
}

fn card(name: &str) -> CardId {
    CardId::ALL
        .into_iter()
        .find(|id| id.as_str() == name)
        .unwrap_or_else(|| panic!("unknown card {name}"))
}

fn ids(list: &[CardId]) -> Vec<&'static str> {
    list.iter().map(|id| id.as_str()).collect()
}

fn build(value: &V) -> Build {
    let mut pairs = Vec::new();
    for (name, count) in value.as_object().unwrap() {
        pairs.push((card(name), count.as_u64().unwrap() as u8));
    }
    Build::from_counts(pairs)
}

fn zone(value: &V) -> Option<FactionId> {
    match value.as_str() {
        Some("fire") => Some(FactionId::Fire),
        Some("sentenced") => Some(FactionId::Sentenced),
        Some("plague") => Some(FactionId::Plague),
        Some("frost") => Some(FactionId::Frost),
        Some("holy") => Some(FactionId::Holy),
        _ => None,
    }
}

#[test]
fn interactive_set_matches_the_source_order() {
    let names = [
        "slowBurn",
        "overkill",
        "tankEngine",
        "pocketSand",
        "gambler",
        "thirdTimesTheCharm",
        "eyeForAnEye",
        "bestOffense",
        "plantYourFeet",
        "wishfulThinking",
        "hemorrhage",
        "spikedShell",
        "siphon",
        "secondWind",
    ];
    assert_eq!(ids(&INTERACTIVE), names);
}

#[test]
fn pool_cases_match_the_source() {
    let corpus = corpus();
    let mut n = 0;
    for case in corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["family"] == "pool")
    {
        let input = &case["input"];
        let pickers: Vec<Build> = input["pickers"]
            .as_array()
            .unwrap()
            .iter()
            .map(build)
            .collect();
        let want = &case["expected"];
        let conditionals: Vec<&str> = want["conditional"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        let augments: Vec<&str> = want["augment"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(
            ids(&conditional_pool(&pickers)),
            conditionals,
            "{}",
            case["id"]
        );
        assert_eq!(ids(&augment_pool(&pickers)), augments, "{}", case["id"]);
        n += 1;
    }
    assert_eq!(n, 30, "pool case count");
}

#[test]
fn roll_cases_match_the_source() {
    let corpus = corpus();
    let mut n = 0;
    for case in corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["family"] == "roll")
    {
        let input = &case["input"];
        let want = &case["expected"];
        let elite = input["opts"]["elite"].as_bool().unwrap_or(false);
        let zone = zone(&input["opts"]["zone"]);
        let tape: Vec<f64> = input["tape"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap())
            .collect();
        let mut cursor = 0usize;
        let mut draws: Vec<(u64, f64)> = Vec::new();
        let mut draw = || {
            let i = cursor;
            cursor += 1;
            let value = tape[i];
            draws.push((i as u64, value));
            value
        };
        let pickers: Vec<Build> = input["opts"]["pickers"]
            .as_array()
            .map(|rows| rows.iter().map(build).collect())
            .unwrap_or_default();
        let pool = augment_pool(&pickers);
        let options = roll_with(&mut draw, &pool, elite, zone);
        let want_options: Vec<&str> = want["options"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(ids(&options), want_options, "{}", case["id"]);
        let want_draws: Vec<(u64, f64)> = want["draws"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| (d["cursor"].as_u64().unwrap(), d["value"].as_f64().unwrap()))
            .collect();
        assert_eq!(draws, want_draws, "{} draws", case["id"]);
        assert_eq!(
            cursor as u64,
            want["cursor"].as_u64().unwrap(),
            "{} cursor",
            case["id"]
        );
        let want_rest: Vec<f64> = want["unusedContinuation"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap())
            .collect();
        assert_eq!(
            &tape[cursor..],
            want_rest.as_slice(),
            "{} continuation",
            case["id"]
        );
        n += 1;
    }
    assert_eq!(n, 181, "roll case count");
}

#[test]
fn zone_themes_are_the_source_lists() {
    let cases = [
        (FactionId::Fire, vec!["slowBurn", "hemorrhage", "overkill"]),
        (
            FactionId::Sentenced,
            vec!["plantYourFeet", "wishfulThinking", "overkill"],
        ),
        (
            FactionId::Plague,
            vec!["hemorrhage", "siphon", "thirdTimesTheCharm"],
        ),
        (
            FactionId::Frost,
            vec!["pocketSand", "bestOffense", "tankEngine"],
        ),
        (
            FactionId::Holy,
            vec!["secondWind", "siphon", "eyeForAnEye", "spikedShell"],
        ),
    ];
    for (faction, want) in cases {
        assert_eq!(ids(zone_theme(faction)), want);
    }
}
