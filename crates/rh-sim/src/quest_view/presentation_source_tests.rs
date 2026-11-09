//! Actual pinned formatter output comparisons over declared contexts, not gameplay acquisitions/outcomes.
use super::*;
use serde_json::Value as V;
fn texts(p: &Presentation) -> V {
    serde_json::json!({"name":p.name,"giver_label":p.giver_label,"brief":p.brief,"objective":p.objective,"reward":p.reward})
}
#[test]
fn all_twenty_definitions_match_actual_source_in_all_180_formatter_contexts() {
    let source: V = serde_json::from_str(include_str!(
        "../../../../parity/quest-presentation/source.json"
    ))
    .unwrap();
    assert_eq!(source["format"], "rh-quest-presentation-source/1");
    assert_eq!(source["cases"].as_array().unwrap().len(), 20);
    let mut probes = 0;
    let mut maxima = [0; 5];
    let mut body = 0;
    for case in source["cases"].as_array().unwrap() {
        let def = crate::quests::def_by_id(case["id"].as_str().unwrap()).unwrap();
        let (stat, stacks) = rules::reward_stats(def);
        assert_eq!(
            stat.as_str(),
            case["actualRewardFacts"]["id"].as_str().unwrap()
        );
        assert_eq!(
            stacks,
            case["actualRewardFacts"]["stacks"].as_u64().unwrap()
        );
        assert_eq!(
            objective(def),
            case["actualHelpers"]["objective"].as_str().unwrap()
        );
        assert_eq!(
            rules::reward_text(def),
            case["actualHelpers"]["fixedReward"].as_str().unwrap()
        );
        let mut local_max = [0; 5];
        for probe in case["probes"].as_array().unwrap() {
            let current = probe["input"]["current"].as_u64();
            let mut farm = Farm::default();
            if let Some(n) = current {
                farm.set(stat, n);
            }
            let state = match probe["input"]["state"].as_str().unwrap() {
                "preview" => RowState::Preview,
                "open" => RowState::Open,
                "done" => RowState::Done,
                "expired" => RowState::Expired,
                other => panic!("unknown context {other}"),
            };
            let actual = if current.is_none() {
                // Optional-count helper domain: a real entitled Native player always has Farm facts.
                build(def, None).unwrap()
            } else {
                for_row(def, state, &farm).unwrap()
            };
            assert_eq!(
                texts(&actual),
                probe["observed"],
                "{} {}",
                def.id,
                probe["input"]["name"]
            );
            let direct = build(def, current.map(|n| (stat, stacks, n))).unwrap();
            assert_eq!(direct.reward, probe["directReward"].as_str().unwrap());
            if let Some(current) = current {
                let bits = u64::from_str_radix(
                    probe["arithmeticDiagnostic"]["binary64BE"]
                        .as_str()
                        .unwrap(),
                    16,
                )
                .unwrap();
                assert_eq!(
                    (current as f64 + stacks as f64).to_bits(),
                    bits,
                    "source Number addition {}",
                    def.id
                );
            }
            for (i, text) in [
                &actual.name,
                &actual.giver_label,
                &actual.brief,
                &actual.objective,
                &actual.reward,
            ]
            .into_iter()
            .enumerate()
            {
                maxima[i] = maxima[i].max(text.len());
                local_max[i] = local_max[i].max(text.len());
            }
            probes += 1;
        }
        body += local_max.into_iter().sum::<usize>();
    }
    assert_eq!(probes, 180);
    assert_eq!(maxima, [25, 22, 96, 61, 91]);
    assert_eq!(body, 4620);
    assert_eq!(body + 20 * 5, 4720);
}
#[test]
fn metadata_bound_is_per_field_utf8_bytes_and_never_truncates() {
    let def = &crate::quests::catalog::DEFINITION[0];
    for field in 0..5 {
        let mut text = build(def, None).unwrap();
        let selected = match field {
            0 => &mut text.name,
            1 => &mut text.giver_label,
            2 => &mut text.brief,
            3 => &mut text.objective,
            _ => &mut text.reward,
        };
        *selected = "é".repeat(127) + "x";
        assert_eq!(selected.len(), 255);
        assert!(text.checked().is_ok());
        let mut text = build(def, None).unwrap();
        let selected = match field {
            0 => &mut text.name,
            1 => &mut text.giver_label,
            2 => &mut text.brief,
            3 => &mut text.objective,
            _ => &mut text.reward,
        };
        *selected = "é".repeat(128);
        assert!(matches!(text.checked(), Err(Error::InvalidLabel)));
    }
}
