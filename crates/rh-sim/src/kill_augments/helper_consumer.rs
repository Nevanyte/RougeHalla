//! Native consumer of the admitted P-TROPHY-WITNESS-1 declared-input helper corpus
//! ('parity/trophy-witness/helpers.json').
//!
//! These are declared ReadableFighter helper cases, NOT runtime lifecycle outputs. The native side consumes them through
//! the real helpers: KillStatKey::ALL/parse/label/flat/DEFINITION, encode/parse, roll, text, grant + KillStats and
//! invested_stats. Declared mirror inputs are synthesized through the actual native trophy grant path (KillStats are part
//! of the same readable score); that is a labelled helper fixture, never a lifecycle state injection.
use crate::kill_augments::{self, KillStatKey, KillStats};
use crate::{FactionId, Placement, PlayerId, Secrets, Sim, SimConfig, Vec2};

const CORPUS: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../parity/trophy-witness/helpers.json"
);

fn corpus() -> serde_json::Value {
    serde_json::from_str(&std::fs::read_to_string(CORPUS).expect("admitted helper corpus"))
        .expect("helper corpus json")
}

fn case<'a>(doc: &'a serde_json::Value, name: &str) -> &'a serde_json::Value {
    doc["cases"]
        .as_array()
        .expect("cases")
        .iter()
        .find(|c| c["name"].as_str() == Some(name))
        .unwrap_or_else(|| panic!("helper case {name}"))
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

fn helper_sim() -> Sim {
    Sim::reset_active(
        SimConfig {
            consumables: false,
            ..Default::default()
        },
        crate::arenas::practice_arena(),
        Secrets::from_seed(7),
        &[Placement {
            profile: "helper".into(),
            faction: FactionId::Holy,
            bot: false,
            at: Vec2::new(400., 400.),
            hp: None,
            weapon0: None,
            weapon1: None,
        }],
    )
}

/// The declared ReadableFighter mirror inputs translated into the actual native Trophy grant path. A wire flat bonus is
/// tenths of a point (source FLAT_WIRE_PER_POINT); a max-hp delta is relative to the declared faction base; a lasting
/// attack/move score exists only with the base card that carries it (the source lasting rule). This is a helper-fixture
/// translation of the declared input, never an expected option/gain installation.
fn grants_for(spec: &serde_json::Value) -> Vec<kill_augments::KillAugment> {
    let mut out = Vec::new();
    let mut push = |key, gain: f64| {
        if gain > 0. {
            out.push(kill_augments::KillAugment { key, gain });
        }
    };
    if let Some(v) = spec.get("adBonus").and_then(|v| v.as_f64()) {
        push(KillStatKey::Ad, v / 10.);
    }
    if let Some(v) = spec.get("apBonus").and_then(|v| v.as_f64()) {
        push(KillStatKey::Ap, v / 10.);
    }
    if let Some(v) = spec.get("armorBonus").and_then(|v| v.as_f64()) {
        push(KillStatKey::Armor, v / 10.);
    }
    if let Some(v) = spec.get("shieldBonus").and_then(|v| v.as_f64()) {
        push(KillStatKey::Mr, v / 10.);
    }
    if let Some(v) = spec.get("maxHp").and_then(|v| v.as_f64()) {
        let base = crate::content::faction(FactionId::Holy).hp;
        push(KillStatKey::Health, v / base - 1.);
    }
    let build = spec.get("build").and_then(|b| b.as_object());
    let has = |id: &str| build.is_some_and(|b| b.contains_key(id));
    if has("haste1") {
        if let Some(v) = spec.get("asMult").and_then(|v| v.as_f64()) {
            push(KillStatKey::AttackSpeed, v / 1000. - 1.);
        }
    }
    if has("fleet1") {
        if let Some(v) = spec.get("speedMult").and_then(|v| v.as_f64()) {
            push(KillStatKey::Speed, v / 1000. - 1.);
        }
    }
    if has("leech1") {
        push(KillStatKey::Leech, 0.05);
    }
    if let Some(stats) = spec
        .get("extra")
        .and_then(|e| e.get("killStats"))
        .and_then(|s| s.as_object())
    {
        for (name, key) in [
            ("damage", KillStatKey::Damage),
            ("maxHp", KillStatKey::Health),
            ("attackSpeed", KillStatKey::AttackSpeed),
            ("moveSpeed", KillStatKey::Speed),
            ("lifesteal", KillStatKey::Leech),
        ] {
            if let Some(v) = stats.get(name).and_then(|v| v.as_f64()) {
                push(key, v);
            }
        }
    }
    out
}

fn synth(spec: &serde_json::Value) -> Sim {
    let mut sim = helper_sim();
    for a in grants_for(spec) {
        assert!(
            kill_augments::grant(&sim.k, &mut sim.w, PlayerId(1), a),
            "real trophy grant {a:?}"
        );
    }
    sim
}

fn score_matches(a: f64, b: f64) -> bool {
    if !(a.is_finite() && b.is_finite()) {
        return false;
    }
    (a - b).abs() <= 1e-9 * a.abs().max(b.abs()).max(1.)
}

fn compare_investments(doc: &serde_json::Value) -> Result<(), String> {
    let c = case(doc, "nine-key-investments-and-options");
    check(
        c["caseKind"] == "declared-input-helper"
            && c["callsActualSharedFunctions"] == true
            && c["notRuntimeOutput"] == true,
        || "case 0 is not labelled declared-input".into(),
    )?;
    let keys: Vec<String> = c["keys"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    let native_keys: Vec<String> = KillStatKey::ALL
        .iter()
        .map(|k| k.as_str().to_string())
        .collect();
    check(keys == native_keys, || {
        format!("KILL_STAT_KEYS order {native_keys:?} != {keys:?}")
    })?;
    for key in KillStatKey::ALL {
        check(KillStatKey::parse(key.as_str()) == Some(key), || {
            format!("KillStatKey::parse round-trip for {}", key.as_str())
        })?;
    }
    check(c["share"] == crate::constants::KILL_AUG_SHARE, || {
        "KILL_AUG_SHARE".into()
    })?;
    check(
        c["optionsMax"].as_u64() == Some(u64::from(crate::constants::KILL_AUG_OPTIONS)),
        || "KILL_AUG_OPTIONS".into(),
    )?;
    check(
        (num(&c["lifetimeSeconds"]) - crate::constants::KILL_AUG_SECONDS).abs() < f64::EPSILON,
        || "KILL_AUG_SECONDS".into(),
    )?;
    check(c["label"] == kill_augments::KILL_AUG_LABEL, || {
        "KILL_AUG_LABEL".into()
    })?;
    for (i, row) in c["result"].as_array().unwrap().iter().enumerate() {
        let key = KillStatKey::ALL[i];
        check(row["key"] == key.as_str(), || {
            format!("case 0 row {i} key {} != {}", key.as_str(), row["key"])
        })?;
        check(kill_augments::DEFINITION.unit[key.index()] > 0., || {
            format!("DEFINITION unit for {}", key.as_str())
        })?;
        let flat = matches!(
            key,
            KillStatKey::Ad | KillStatKey::Ap | KillStatKey::Armor | KillStatKey::Mr
        );
        check(key.flat() == flat, || {
            format!("flat() for {}", key.as_str())
        })?;
        check(!key.label().is_empty(), || {
            format!("label() for {}", key.as_str())
        })?;
        let sim = synth(&row["victimSpec"]);
        let p = &sim.w.players[0];
        let options: Vec<String> = kill_augments::roll(p)
            .iter()
            .map(|a| kill_augments::encode(*a))
            .collect();
        let want: Vec<String> = row["options"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        check(options == want, || {
            format!("case 0 {} options {options:?} != {want:?}", key.as_str())
        })?;
        let parsed: Vec<(String, f64)> = kill_augments::roll(p)
            .iter()
            .map(|a| (a.key.as_str().to_string(), a.gain))
            .collect();
        let want_parsed: Vec<(String, f64)> = row["parsed"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| (r["key"].as_str().unwrap().to_string(), num(&r["gain"])))
            .collect();
        check(parsed == want_parsed, || {
            format!(
                "case 0 {} parsed {parsed:?} != {want_parsed:?}",
                key.as_str()
            )
        })?;
        let first = kill_augments::roll(p)[0];
        let (title, text) = kill_augments::text(first);
        check(title == row["text"]["title"].as_str().unwrap(), || {
            format!(
                "case 0 {} title {title:?} != {}",
                key.as_str(),
                row["text"]["title"]
            )
        })?;
        check(text == row["text"]["text"].as_str().unwrap(), || {
            format!(
                "case 0 {} text {text:?} != {}",
                key.as_str(),
                row["text"]["text"]
            )
        })?;
        let native_scores: Vec<(String, f64)> = kill_augments::invested_stats(p)
            .into_iter()
            .map(|(k, s)| (k.as_str().to_string(), s))
            .collect();
        let want_scores: Vec<(String, f64)> = row["readability"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| (r["key"].as_str().unwrap().to_string(), num(&r["score"])))
            .collect();
        check(
            native_scores.len() == want_scores.len()
                && native_scores
                    .iter()
                    .zip(&want_scores)
                    .all(|((k, s), (wk, ws))| k == wk && score_matches(*s, *ws)),
            || {
                format!(
                    "case 0 {} readability {native_scores:?} != {want_scores:?}",
                    key.as_str()
                )
            },
        )?;
        // The source UNIT a declared helper row exercises, derived from the actual source output, against DEFINITION.
        let unit = num(&row["parsed"][0]["gain"])
            / (num(&row["readability"][0]["score"]) * crate::constants::KILL_AUG_SHARE);
        check(
            score_matches(unit, kill_augments::DEFINITION.unit[key.index()]),
            || {
                format!(
                    "case 0 {} UNIT {unit} != {}",
                    key.as_str(),
                    kill_augments::DEFINITION.unit[key.index()]
                )
            },
        )?;
    }
    Ok(())
}

fn compare_wording(doc: &serde_json::Value) -> Result<(), String> {
    let c = case(doc, "flat-versus-percentage-wording");
    for row in c["result"].as_array().unwrap() {
        let key = KillStatKey::parse(row["key"].as_str().unwrap()).expect("declared key");
        let raw = num(&row["raw"]);
        let a = kill_augments::KillAugment { key, gain: raw };
        let encoded = kill_augments::encode(a);
        check(encoded == row["encoded"].as_str().unwrap(), || {
            format!("{} encode {encoded} != {}", key.as_str(), row["encoded"])
        })?;
        let parsed = kill_augments::parse(&encoded).expect("encoded id parses");
        let (title, text) = kill_augments::text(parsed);
        check(title == row["text"]["title"].as_str().unwrap(), || {
            format!(
                "{} text title {title:?} != {}",
                key.as_str(),
                row["text"]["title"]
            )
        })?;
        check(text == row["text"]["text"].as_str().unwrap(), || {
            format!(
                "{} text body {text:?} != {}",
                key.as_str(),
                row["text"]["text"]
            )
        })?;
    }
    Ok(())
}

fn compare_round_trips(doc: &serde_json::Value) -> Result<(), String> {
    let c = case(doc, "encode-parse-rounding-and-refusals");
    for row in c["result"]["roundTrips"].as_array().unwrap() {
        let key = KillStatKey::parse(row["key"].as_str().unwrap()).expect("declared key");
        let id = kill_augments::encode(kill_augments::KillAugment {
            key,
            gain: num(&row["raw"]),
        });
        check(id == row["id"].as_str().unwrap(), || {
            format!("roundTrip {} id {id} != {}", key.as_str(), row["id"])
        })?;
        let parsed = kill_augments::parse(&id);
        let want = &row["parsed"];
        if want.is_null() {
            check(parsed.is_none(), || {
                format!("roundTrip {id} should be refused, got {parsed:?}")
            })?;
        } else {
            let parsed = parsed.ok_or_else(|| format!("roundTrip {id} should parse"))?;
            check(
                parsed.key.as_str() == want["key"].as_str().unwrap()
                    && parsed.gain == num(&want["gain"]),
                || format!("roundTrip {id} parsed {parsed:?} != {want}"),
            )?;
        }
    }
    for row in c["result"]["malformed"].as_array().unwrap() {
        let got = kill_augments::parse(row["id"].as_str().unwrap());
        if row["parsed"].is_null() {
            check(got.is_none(), || {
                format!("malformed {} parsed {got:?}", row["id"])
            })?;
        } else {
            let got = got.ok_or_else(|| format!("malformed {} should parse", row["id"]))?;
            check(
                got.key.as_str() == row["parsed"]["key"].as_str().unwrap()
                    && got.gain == num(&row["parsed"]["gain"]),
                || format!("malformed {} parsed {got:?}", row["id"]),
            )?;
        }
    }
    Ok(())
}

fn compare_ranking(doc: &serde_json::Value) -> Result<(), String> {
    let c = case(doc, "ranking-ties-truncation");
    for row in c["result"].as_array().unwrap() {
        let sim = synth(&row["spec"]);
        let p = &sim.w.players[0];
        let options: Vec<String> = kill_augments::roll(p)
            .iter()
            .map(|a| kill_augments::encode(*a))
            .collect();
        let want: Vec<String> = row["options"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        check(options == want, || {
            format!(
                "ranking {} options {options:?} != {want:?}",
                row["name"].as_str().unwrap()
            )
        })?;
        let parsed: Vec<(String, f64)> = kill_augments::roll(p)
            .iter()
            .map(|a| (a.key.as_str().to_string(), a.gain))
            .collect();
        let want_parsed: Vec<(String, f64)> = row["parsed"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| (r["key"].as_str().unwrap().to_string(), num(&r["gain"])))
            .collect();
        check(parsed == want_parsed, || {
            format!(
                "ranking {} parsed {parsed:?} != {want_parsed:?}",
                row["name"].as_str().unwrap()
            )
        })?;
        let native_scores: Vec<(String, f64)> = kill_augments::invested_stats(p)
            .into_iter()
            .map(|(k, s)| (k.as_str().to_string(), s))
            .collect();
        let want_scores: Vec<(String, f64)> = row["readability"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| (r["key"].as_str().unwrap().to_string(), num(&r["score"])))
            .collect();
        check(
            native_scores.len() == want_scores.len()
                && native_scores
                    .iter()
                    .zip(&want_scores)
                    .all(|((k, s), (wk, ws))| k == wk && score_matches(*s, *ws)),
            || {
                format!(
                    "ranking {} readability {native_scores:?} != {want_scores:?}",
                    row["name"].as_str().unwrap()
                )
            },
        )?;
    }
    Ok(())
}

fn store_key(name: &str) -> Option<KillStatKey> {
    Some(match name {
        "ad" => KillStatKey::Ad,
        "ap" => KillStatKey::Ap,
        "damage" => KillStatKey::Damage,
        "maxHp" => KillStatKey::Health,
        "attackSpeed" => KillStatKey::AttackSpeed,
        "armor" => KillStatKey::Armor,
        "shield" => KillStatKey::Mr,
        "moveSpeed" => KillStatKey::Speed,
        "lifesteal" => KillStatKey::Leech,
        _ => return None,
    })
}

fn row_name(kind: crate::stat_fold::EffectKind) -> Option<(&'static str, &'static str, f64)> {
    use crate::stat_fold::{EffectKind, EffectStat, FlatStat};
    Some(match kind {
        EffectKind::Flat {
            stat: FlatStat::Ad,
            v,
        } => ("flat", "ad", v),
        EffectKind::Flat {
            stat: FlatStat::Ap,
            v,
        } => ("flat", "ap", v),
        EffectKind::Flat {
            stat: FlatStat::Armor,
            v,
        } => ("flat", "armor", v),
        EffectKind::Flat {
            stat: FlatStat::Shield,
            v,
        } => ("flat", "shield", v),
        EffectKind::Stat {
            stat: EffectStat::Damage,
            v,
        } => ("stat", "damage", v),
        EffectKind::Stat {
            stat: EffectStat::MaxHp,
            v,
        } => ("stat", "maxHp", v),
        EffectKind::Stat {
            stat: EffectStat::AttackSpeed,
            v,
        } => ("stat", "attackSpeed", v),
        EffectKind::Stat {
            stat: EffectStat::MoveSpeed,
            v,
        } => ("stat", "moveSpeed", v),
        EffectKind::Stat {
            stat: EffectStat::Lifesteal,
            v,
        } => ("stat", "lifesteal", v),
        _ => return None,
    })
}

fn compare_grant_store(doc: &serde_json::Value) -> Result<(), String> {
    let c = case(doc, "kill-augment-grant-store-map");
    let mut sim = helper_sim();
    for row in c["result"].as_array().unwrap() {
        let id = row["id"].as_str().unwrap();
        let parsed = kill_augments::parse(id).expect("declared id parses");
        check(
            parsed.key.as_str() == row["parsed"]["key"].as_str().unwrap(),
            || format!("grant {id} key"),
        )?;
        check(parsed.gain == num(&row["parsed"]["gain"]), || {
            format!("grant {id} gain")
        })?;
        let before = sim.w.players[0].kill_stats.get(parsed.key);
        assert!(
            kill_augments::grant(&sim.k, &mut sim.w, PlayerId(1), parsed),
            "real trophy grant {id}"
        );
        check(
            sim.w.players[0].kill_stats.get(parsed.key) == before + parsed.gain,
            || format!("grant {id} stored value"),
        )?;
        let mut stats = KillStats::default();
        stats.add(parsed.key, parsed.gain);
        let (rows, n) = stats.rows();
        check(n == 1, || format!("grant {id} one row"))?;
        let (_, store, v) = row_name(rows[0].kind).expect("a store row");
        check(store == row["grant"]["stat"].as_str().unwrap(), || {
            format!("grant {id} store {store} != {}", row["grant"]["stat"])
        })?;
        check(v == num(&row["grant"]["v"]), || {
            format!("grant {id} row value {v} != {}", row["grant"]["v"])
        })?;
    }
    Ok(())
}

fn compare_effects(doc: &serde_json::Value) -> Result<(), String> {
    let c = case(doc, "kill-stat-effects-rows");
    for case_row in c["result"].as_array().unwrap() {
        let mut stats = KillStats::default();
        for (name, value) in case_row["stats"].as_object().unwrap() {
            let Some(key) = store_key(name) else { continue };
            let Some(v) = value.as_f64() else { continue };
            if v == 0. {
                continue;
            }
            stats.add(key, v);
        }
        let (rows, n) = stats.rows();
        let mut got: Vec<(String, String, f64)> = rows[..n]
            .iter()
            .map(|r| {
                let (k, stat, v) = row_name(r.kind).expect("a fold row");
                (k.to_string(), stat.to_string(), v)
            })
            .collect();
        got.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
        let mut want: Vec<(String, String, f64)> = case_row["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| {
                (
                    r["k"].as_str().unwrap().to_string(),
                    r["stat"].as_str().unwrap().to_string(),
                    num(&r["v"]),
                )
            })
            .collect();
        want.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
        check(got == want, || {
            format!(
                "effects {} rows {got:?} != {want:?}",
                case_row["name"].as_str().unwrap()
            )
        })?;
    }
    Ok(())
}

fn compare_readability(doc: &serde_json::Value) -> Result<(), String> {
    let c = case(doc, "combat-readability-declared-all-nine");
    let result = &c["result"];
    let sim = synth(&result["spec"]);
    let p = &sim.w.players[0];
    let native: Vec<(String, f64)> = kill_augments::invested_stats(p)
        .into_iter()
        .map(|(k, s)| (k.as_str().to_string(), s))
        .collect();
    let want: Vec<(String, f64)> = result["readability"]["investedStats"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| (r["key"].as_str().unwrap().to_string(), num(&r["score"])))
        .collect();
    check(
        native.len() == want.len()
            && native
                .iter()
                .zip(&want)
                .all(|((k, s), (wk, ws))| k == wk && score_matches(*s, *ws)),
        || format!("readability investedStats {native:?} != {want:?}"),
    )?;
    let options: Vec<String> = kill_augments::roll(p)
        .iter()
        .map(|a| kill_augments::encode(*a))
        .collect();
    let want_options: Vec<String> = result["options"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    check(options == want_options, || {
        format!("readability options {options:?} != {want_options:?}")
    })?;
    // GAP (explicit): the source combatReadability powerRatio/power and its display label/short metadata have no native
    // equivalent in invested_stats; the native consumer compares only the invested key/score order and the roll options.
    check(
        result["readability"].get("powerRatio").is_some()
            && result["readability"].get("power").is_some(),
        || "declared readability power fields".into(),
    )?;
    Ok(())
}

fn compare_all(doc: &serde_json::Value) -> Result<(), String> {
    check(doc["format"] == "rh-trophy-helpers-source/1", || {
        "helper corpus format".into()
    })?;
    compare_investments(doc)?;
    compare_wording(doc)?;
    compare_round_trips(doc)?;
    compare_ranking(doc)?;
    compare_grant_store(doc)?;
    compare_effects(doc)?;
    compare_readability(doc)?;
    Ok(())
}

#[test]
fn all_nine_key_helper_cases_reproduce_natively() {
    let doc = corpus();
    compare_all(&doc).unwrap_or_else(|e| panic!("helper consumer: {e}"));
    assert_eq!(doc["cases"].as_array().unwrap().len(), 7);
    assert!(doc["evidence"]
        .as_str()
        .unwrap()
        .contains("NOT runtime lifecycle outputs"));
}

/// Compiled semantic control: a provenance-only mutation is NOT a kill; every semantic mutation is.
#[test]
fn helper_semantic_controls_require_a_field_difference() {
    let doc = corpus();
    compare_all(&doc).expect("baseline helper corpus passes");
    // Provenance-only: changing a recorded source/tool hash must not change any semantic result.
    let mut provenance_only = doc.clone();
    provenance_only["provenance"]["tools"]["captureMts"] =
        serde_json::json!("0000000000000000000000000000000000000000000000000000000000000000");
    compare_all(&provenance_only).expect("provenance-only mutation is not a semantic kill");
    // Wrong wording.
    let mut wording = doc.clone();
    wording["cases"][1]["result"][0]["text"]["title"] = serde_json::json!("+3.2 Offense");
    let err = compare_all(&wording).expect_err("wrong title must be reported");
    assert!(err.contains("text title"), "{err}");
    // Wrong rounding/encode.
    let mut rounding = doc.clone();
    rounding["cases"][2]["result"]["roundTrips"][0]["id"] = serde_json::json!("kill:ad:1.1");
    let err = compare_all(&rounding).expect_err("wrong encoded id must be reported");
    assert!(err.contains("id"), "{err}");
    // Wrong ranking order.
    let mut ranking = doc.clone();
    ranking["cases"][3]["result"][0]["options"][0] = serde_json::json!("kill:armor:15.0");
    let err = compare_all(&ranking).expect_err("wrong option order must be reported");
    assert!(err.contains("options"), "{err}");
    // Wrong grant arithmetic.
    let mut grant = doc.clone();
    grant["cases"][4]["result"][0]["grant"]["v"] = serde_json::json!(3.0);
    let err = compare_all(&grant).expect_err("wrong grant value must be reported");
    assert!(
        err.contains("row value") || err.contains("stored value"),
        "{err}"
    );
    // Restore the control: the unchanged corpus passes again.
    compare_all(&doc).expect("restored helper corpus passes");
}
