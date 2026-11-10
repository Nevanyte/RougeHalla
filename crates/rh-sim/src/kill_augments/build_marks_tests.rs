//! The overhead build marks (ADR0026, B2) against the legacy formula: `parity/build-marks/legacy.json`, written by
//! `parity/legacy-capture/build-marks.ts` from `packages/shared/src/combatReadability.ts` (display mode). Each case gives
//! the public inputs (faction, cards, decoded mirrors, max hp, kill stats); the Rust scores must equal the legacy
//! `investedStats` bit for bit and the marks must be its first two keys.
use super::{invested_scores, top_two, KillStatKey, KillStats, Readable};
use crate::cards::{Build, CardId};
use crate::stat_fold::StatMirrors;
use crate::FactionId;

const CAPTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../parity/build-marks/legacy.json"
);

fn faction(s: &str) -> FactionId {
    FactionId::ALL
        .into_iter()
        .find(|f| f.as_str() == s)
        .unwrap_or_else(|| panic!("faction {s}"))
}

fn key(s: &str) -> KillStatKey {
    // The legacy readability keys equal the trophy keys; its kill-stat map spells leech "lifesteal".
    KillStatKey::parse(if s == "lifesteal" { "leech" } else { s })
        .unwrap_or_else(|| panic!("stat key {s}"))
}

#[test]
fn build_marks_match_the_legacy_readability_formula() {
    let doc: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(CAPTURE).expect("build-marks capture"))
            .expect("build-marks json");
    assert_eq!(doc["format"], "rh-build-marks/1");
    let cases = doc["cases"].as_array().expect("cases");
    assert!(
        cases.len() >= 8,
        "the capture covers ties, thresholds and every source of a score"
    );
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let build = Build::from_counts(case["cards"].as_object().unwrap().iter().map(|(id, n)| {
            let card = CardId::ALL
                .into_iter()
                .find(|c| c.as_str() == id)
                .unwrap_or_else(|| panic!("{name}: card {id}"));
            (card, n.as_u64().unwrap() as u8)
        }));
        let m = &case["mirrors"];
        let f = |k: &str| m[k].as_f64().unwrap();
        let mirrors = StatMirrors {
            as_mult: f("asMult"),
            windup_mult: f("windupMult"),
            speed_mult: f("speedMult"),
            armor_bonus: f("armorBonus"),
            shield_bonus: f("shieldBonus"),
            ad_bonus: f("adBonus"),
            ap_bonus: f("apBonus"),
        };
        let mut kill = KillStats::default();
        for (k, v) in case["killStats"].as_object().unwrap() {
            kill.add(key(k), v.as_f64().unwrap());
        }
        // No mob stats in the capture: the farm rows are empty (kill stats are read as stored values, as in the source).
        let r = Readable {
            build: &build,
            faction: faction(case["faction"].as_str().unwrap()),
            mirrors,
            max_hp: case["maxHp"].as_f64().unwrap(),
            farm_rows: &[],
            kill: &kill,
        };
        let scores = invested_scores(&r, false);
        let want: Vec<(KillStatKey, f64)> = case["invested"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| {
                (
                    key(s["key"].as_str().unwrap()),
                    s["score"].as_f64().unwrap(),
                )
            })
            .collect();
        for (k, score) in &want {
            assert_eq!(
                scores[k.index()].to_bits(),
                score.to_bits(),
                "{name}: {k:?}"
            );
        }
        for k in KillStatKey::ALL {
            if !want.iter().any(|(w, _)| *w == k) {
                assert!(
                    !(scores[k.index()] > 0.01),
                    "{name}: {k:?} = {} is not shown by legacy",
                    scores[k.index()]
                );
            }
        }
        let marks: Vec<KillStatKey> = case["marks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| key(s.as_str().unwrap()))
            .collect();
        let got: Vec<KillStatKey> = top_two(&scores).into_iter().flatten().collect();
        assert_eq!(got, marks, "{name}");
    }
}

#[test]
fn top_two_keeps_the_earlier_key_on_a_tie_and_skips_small_or_nan_scores() {
    let mut s = [0.0; 9];
    assert_eq!(top_two(&s), [None, None]);
    s[KillStatKey::Leech.index()] = 3.0;
    s[KillStatKey::Ap.index()] = 3.0;
    s[KillStatKey::Ad.index()] = 0.01;
    s[KillStatKey::Armor.index()] = f64::NAN;
    assert_eq!(
        top_two(&s),
        [Some(KillStatKey::Ap), Some(KillStatKey::Leech)]
    );
    s[KillStatKey::Mr.index()] = 4.0;
    assert_eq!(top_two(&s), [Some(KillStatKey::Mr), Some(KillStatKey::Ap)]);
    s = [0.0; 9];
    s[KillStatKey::Speed.index()] = 0.02;
    assert_eq!(top_two(&s), [Some(KillStatKey::Speed), None]);
}
