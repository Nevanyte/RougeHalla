//! Oracle for packet P-BALANCE-2 (docs/backlog/packets/P-BALANCE-2.md): the camp-clear bench `camp_bench`.
//!
//! The bench is a binary; these tests run it as a process and read the JSON report it prints (schema: packet section
//! 8a). The expected inventory is computed here from the mob catalog and the content tables, never from the bench.
//! Nothing here asserts a balance number: the bench is evidence, not a gate on today's numbers. What is pinned is that
//! the report is complete, ordered, deterministic, honest about truncation and death, internally consistent, and
//! sensitive to what it measures.
//!
//! Debug `cargo test` runs `--quick` subsets with a small `--max-ticks`; the full 1800-cell run is the `#[ignore]`d
//! test at the end (`cargo test --release -p rh-headless --test camp_bench -- --ignored`).
use rh_sim::mob_catalog::{elites_of, normal_types_of};
use rh_sim::{FactionId, WeaponId};
use serde_json::{json, Value};
use std::process::Command;
use std::sync::OnceLock;

/// The metrics of a cell, in the order the comparisons and the out-of-band list use.
const METRICS: [&str; 6] = [
    "ticks_to_clear",
    "damage_dealt",
    "damage_taken",
    "hp_remaining",
    "healing_received",
    "chill_seconds",
];
/// Relative band, plus or minus 10% (owner-approved plan 2026-11-10). Must equal the bench's named constant `BAND`.
const BAND_REL: f64 = 0.10;
/// `--max-ticks` for the debug-build data tests: small enough to be affordable, large enough to fight.
const TEST_TICKS: u32 = 400;
const FULL_DEFAULT_TICKS: u64 = 1800; // 90 s at 20 Hz: the legacy campDuel cap (--cap SECONDS (90), campDuel.ts:33)

const QUICK_FACTIONS: [FactionId; 2] = [FactionId::Frost, FactionId::Holy];
const QUICK_WEAPONS: [WeaponId; 2] = [WeaponId::Sword, WeaponId::Wand];

/// (zone, mob type id, elite) for every camp kind, in the canonical order: zone in `FactionId::ALL` order, that zone's
/// normal types in catalog order, then its elites in catalog order.
fn kinds() -> Vec<(String, String, bool)> {
    let mut out = Vec::new();
    for zone in FactionId::ALL {
        for t in normal_types_of(zone) {
            out.push((zone.as_str().to_string(), t.id.as_str().to_string(), false));
        }
        for t in elites_of(zone) {
            out.push((zone.as_str().to_string(), t.id.as_str().to_string(), true));
        }
    }
    out
}

/// The quick subset of kinds: the first normal type and the first elite of the first zone.
fn quick_kinds() -> Vec<(String, String, bool)> {
    let zone = FactionId::ALL[0];
    vec![
        (
            zone.as_str().to_string(),
            normal_types_of(zone)
                .next()
                .unwrap()
                .id
                .as_str()
                .to_string(),
            false,
        ),
        (
            zone.as_str().to_string(),
            elites_of(zone).next().unwrap().id.as_str().to_string(),
            true,
        ),
    ]
}

/// Expected cell keys `faction/weapon/kind/mode`, faction x weapon x kind x mode (mode innermost), each exactly once.
fn expected_keys(quick: bool, modes: &[&str]) -> Vec<String> {
    let factions: Vec<FactionId> = if quick {
        QUICK_FACTIONS.to_vec()
    } else {
        FactionId::ALL.to_vec()
    };
    let weapons: Vec<WeaponId> = if quick {
        QUICK_WEAPONS.to_vec()
    } else {
        WeaponId::ALL.to_vec()
    };
    let ks = if quick { quick_kinds() } else { kinds() };
    let mut out = Vec::new();
    // Order follows the content tables, restricted to the subset.
    for f in FactionId::ALL.into_iter().filter(|f| factions.contains(f)) {
        for w in WeaponId::ALL.into_iter().filter(|w| weapons.contains(w)) {
            for (_, k, _) in &ks {
                for m in modes {
                    out.push(format!("{}/{}/{}/{}", f.as_str(), w.as_str(), k, m));
                }
            }
        }
    }
    out
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str()
        .unwrap_or_else(|| panic!("field {k} missing or not a string in {v}"))
}
fn num(v: &Value, k: &str) -> f64 {
    let x = v[k]
        .as_f64()
        .unwrap_or_else(|| panic!("field {k} missing or not a number in {v}"));
    assert!(x.is_finite(), "field {k} is not finite in {v}");
    x
}
fn cell_key(c: &Value) -> String {
    format!(
        "{}/{}/{}/{}",
        s(c, "faction"),
        s(c, "weapon"),
        s(c, "kind"),
        s(c, "mode")
    )
}
fn scenario_key(c: &Value) -> String {
    format!("{}/{}/{}", s(c, "faction"), s(c, "weapon"), s(c, "kind"))
}
fn keys_of(report: &Value) -> Vec<String> {
    report["cells"]
        .as_array()
        .expect("cells is an array")
        .iter()
        .map(cell_key)
        .collect()
}

fn run_raw(args: &[&str]) -> String {
    let out = Command::new(env!("CARGO_BIN_EXE_camp_bench"))
        .args(args)
        .output()
        .expect("camp_bench starts");
    assert!(
        out.status.success(),
        "camp_bench {args:?} must exit 0 once it ran and reported (stderr: {})",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).expect("report is utf-8")
}
fn run(args: &[&str]) -> Value {
    serde_json::from_str(&run_raw(args)).expect("stdout is exactly one JSON report")
}
fn ticks_arg() -> String {
    TEST_TICKS.to_string()
}

/// One shared quick run (seed 1, small tick cap): the raw bytes and the parsed report.
fn baseline() -> &'static (String, Value) {
    static B: OnceLock<(String, Value)> = OnceLock::new();
    B.get_or_init(|| {
        let t = ticks_arg();
        let raw = run_raw(&["--quick", "--seed", "1", "--max-ticks", &t]);
        let v = serde_json::from_str(&raw).expect("stdout is exactly one JSON report");
        (raw, v)
    })
}

/// The checker a report must pass. An empty or partial report fails it.
fn validate_report(report: &Value, quick: bool) -> Result<(), String> {
    if report["version"] != json!(1) {
        return Err("version must be 1".into());
    }
    let cells = report["cells"].as_array().ok_or("cells missing")?;
    if cells.is_empty() {
        return Err("empty report: no cells".into());
    }
    let want = expected_keys(quick, &["legacy", "archetypes"]);
    let got = keys_of(report);
    if got != want {
        return Err(format!(
            "inventory differs: {} cells reported, {} expected",
            got.len(),
            want.len()
        ));
    }
    if report["comparisons"].as_array().map_or(0, |c| c.len()) != want.len() / 2 {
        return Err("one comparison per scenario is required".into());
    }
    Ok(())
}

#[test]
fn full_inventory_is_complete_ordered_and_exactly_once() {
    // 5 zones x (4 normal + 2 elite) = 30 camp kinds, from the catalog (the legacy `--types` view has the same 30 rows).
    assert_eq!(
        kinds().len(),
        30,
        "catalog: 5 zones x (4 normals + 2 elites)"
    );
    let r = run(&["--list", "--seed", "1"]);
    assert_eq!(r["version"], json!(1));
    assert_eq!(
        r["list_only"],
        json!(true),
        "--list runs nothing and says so"
    );
    assert_eq!(r["quick"], json!(false));
    assert_eq!(
        r["max_ticks"].as_u64(),
        Some(FULL_DEFAULT_TICKS),
        "default cap is the legacy 90 s"
    );
    let want = expected_keys(false, &["legacy", "archetypes"]);
    assert_eq!(want.len(), 5 * 6 * 30 * 2, "faction x weapon x kind x mode");
    let got = keys_of(&r);
    assert_eq!(
        got.len(),
        want.len(),
        "complete inventory: {} cells expected",
        want.len()
    );
    assert_eq!(
        got, want,
        "ordered faction x weapon x kind x mode, mode innermost"
    );
    let mut sorted = got.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted.len(), got.len(), "each cell exactly once");
    // The kind label carries its zone and tier, and they agree with the catalog.
    let ks = kinds();
    for c in r["cells"].as_array().unwrap() {
        let k = s(c, "kind");
        let (zone, _, elite) = ks.iter().find(|(_, t, _)| t == k).unwrap_or_else(|| {
            panic!("kind {k} is not in the mob catalog");
        });
        assert_eq!(s(c, "zone"), zone, "zone of {k}");
        assert_eq!(c["elite"], json!(*elite), "elite flag of {k}");
    }
}

#[test]
fn quick_inventory_is_the_documented_subset_and_opt_in_columns_are_labelled() {
    let r = run(&["--list", "--quick", "--seed", "1"]);
    assert_eq!(r["quick"], json!(true));
    let want = expected_keys(true, &["legacy", "archetypes"]);
    assert_eq!(want.len(), 16);
    assert_eq!(
        keys_of(&r),
        want,
        "quick = Frost,Holy x Sword,Wand x 2 kinds x 2 modes"
    );
    // Mob spacing: the live profiles run Archetypes with spacing Auto; the spacing-off column is measurement-only and
    // appears only on request, as its own labelled mode after the two live modes of each scenario.
    let r3 = run(&["--list", "--quick", "--seed", "1", "--with-nospacing"]);
    assert_eq!(
        keys_of(&r3),
        expected_keys(true, &["legacy", "archetypes", "archetypes-nospacing"]),
        "--with-nospacing adds exactly one labelled mode per scenario"
    );
}

#[test]
fn quick_run_reports_every_cell_with_consistent_metrics() {
    let r = &baseline().1;
    validate_report(r, true).expect("a real run passes the checker");
    assert_eq!(r["list_only"], json!(false));
    assert_eq!(r["seed"].as_u64(), Some(1));
    assert_eq!(r["max_ticks"].as_u64(), Some(u64::from(TEST_TICKS)));
    let ks = kinds();
    for c in r["cells"].as_array().unwrap() {
        let key = cell_key(c);
        for m in METRICS {
            assert!(num(c, m) >= 0.0, "{key}: {m} is negative");
        }
        let hp0 = num(c, "hp_start");
        assert!(hp0 > 0.0, "{key}: hp_start");
        let hp = num(c, "hp_remaining");
        let taken = num(c, "damage_taken");
        let ticks = c["ticks_to_clear"]
            .as_u64()
            .unwrap_or_else(|| panic!("{key}: ticks_to_clear is an integer"));
        assert!(c["mobs"].as_u64().unwrap_or(0) > 0, "{key}: camp has mobs");
        assert!(hp <= hp0 + 1e-6, "{key}: hp_remaining above hp_start");
        // Damage taken counts every source: the fighter cannot have lost hp the report did not charge to it.
        assert!(
            hp + taken + 1e-6 >= hp0,
            "{key}: hp {hp} + taken {taken} < start {hp0}: damage taken is undercounted"
        );
        assert!(
            (1..=u64::from(TEST_TICKS)).contains(&ticks),
            "{key}: ticks {ticks} outside 1..=max_ticks"
        );
        match s(c, "outcome") {
            "cleared" => {
                assert!(hp > 0.0, "{key}: cleared with no hp left");
                assert!(
                    num(c, "damage_dealt") > 0.0,
                    "{key}: cleared without dealing damage"
                );
            }
            "died" => {
                assert_eq!(hp, 0.0, "{key}: a dead fighter has 0 hp left");
                assert!(
                    taken + 1e-6 >= hp0,
                    "{key}: died having taken less than its hp"
                );
            }
            "truncated" => {
                assert_eq!(
                    ticks,
                    u64::from(TEST_TICKS),
                    "{key}: truncated runs to the cap"
                );
                assert!(hp > 0.0, "{key}: truncated yet dead");
            }
            other => panic!("{key}: outcome {other:?} is not cleared|died|truncated"),
        }
        let (zone, _, elite) = ks
            .iter()
            .find(|(_, t, _)| t == s(c, "kind"))
            .expect("kind in catalog");
        assert_eq!((s(c, "zone"), &c["elite"]), (zone.as_str(), &json!(*elite)));
    }
}

#[test]
fn both_modes_of_a_scenario_fight_the_same_camp() {
    let r = &baseline().1;
    validate_report(r, true).expect("complete report first");
    let cells = r["cells"].as_array().unwrap();
    for pair in cells.chunks(2) {
        let (l, a) = (&pair[0], &pair[1]);
        assert_eq!((s(l, "mode"), s(a, "mode")), ("legacy", "archetypes"));
        assert_eq!(scenario_key(l), scenario_key(a));
        for k in ["camp", "mobs", "roster_type", "hp_start"] {
            assert_eq!(
                l[k],
                a[k],
                "{}: {k} must be identical in both modes (same world, same camp)",
                scenario_key(l)
            );
        }
        assert!(l["camp"].is_u64(), "camp index reported");
    }
}

#[test]
fn two_runs_with_one_seed_are_byte_identical() {
    let t = ticks_arg();
    let again = run_raw(&["--quick", "--seed", "1", "--max-ticks", &t]);
    assert!(!again.is_empty());
    assert_eq!(baseline().0, again, "same seed, same inventory: same bytes");
    // The seed is used: it is echoed, and a listing under another seed says so.
    let other = run(&["--list", "--quick", "--seed", "2"]);
    assert_eq!(other["seed"].as_u64(), Some(2));
}

#[test]
fn truncated_cells_are_reported_not_dropped() {
    // 20 ticks (1 s) cannot clear a camp: every cell must still be present, marked truncated, at the cap.
    let r = run(&["--quick", "--seed", "1", "--max-ticks", "20"]);
    assert_eq!(r["max_ticks"].as_u64(), Some(20));
    validate_report(&r, true).expect("a truncated run still reports the full inventory");
    for c in r["cells"].as_array().unwrap() {
        let key = cell_key(c);
        assert_eq!(s(c, "outcome"), "truncated", "{key}");
        assert_eq!(
            c["ticks_to_clear"].as_u64(),
            Some(20),
            "{key}: runs to the cap"
        );
        assert!(num(c, "hp_remaining") > 0.0, "{key}");
    }
    // The comparisons and the listing survive with finite numbers (no division by zero on empty metrics).
    for cmp in r["comparisons"].as_array().unwrap() {
        assert_eq!(cmp["outcomes"], json!(["truncated", "truncated"]));
        for m in METRICS {
            let d = &cmp["metrics"][m];
            assert!(
                d["legacy"].is_number() && d["archetypes"].is_number(),
                "{m}"
            );
            assert!(
                d["rel_delta"].is_null() || d["rel_delta"].as_f64().unwrap().is_finite(),
                "{m}"
            );
        }
    }
}

#[test]
fn an_empty_report_fails_the_checker() {
    let empty =
        json!({"version":1,"seed":1,"quick":true,"cells":[],"comparisons":[],"out_of_band":[]});
    assert!(
        validate_report(&empty, true).is_err(),
        "an empty report must fail"
    );
    let mut partial = baseline().1.clone();
    partial["cells"].as_array_mut().unwrap().pop();
    assert!(
        validate_report(&partial, true).is_err(),
        "a report missing a cell must fail"
    );
    // The checker is not vacuous: the real report passes it, and the stub (empty) does not.
    validate_report(&baseline().1, true).expect("the real quick report passes");
}

/// Relative difference of a metric between modes: (a - l) / l; both zero is 0; zero legacy with nonzero archetypes is
/// undefined (JSON null) and counts as out of band.
fn rel(l: f64, a: f64) -> Option<f64> {
    if l == 0.0 {
        if a == 0.0 {
            Some(0.0)
        } else {
            None
        }
    } else {
        Some((a - l) / l)
    }
}

#[test]
fn every_scenario_carries_per_metric_deltas() {
    let r = &baseline().1;
    validate_report(r, true).expect("complete report first");
    let cells = r["cells"].as_array().unwrap();
    let cmps = r["comparisons"].as_array().unwrap();
    assert_eq!(cmps.len(), cells.len() / 2, "one comparison per scenario");
    for (cmp, pair) in cmps.iter().zip(cells.chunks(2)) {
        let (l, a) = (&pair[0], &pair[1]);
        assert_eq!(
            format!(
                "{}/{}/{}",
                s(cmp, "faction"),
                s(cmp, "weapon"),
                s(cmp, "kind")
            ),
            scenario_key(l),
            "comparisons follow the cell order"
        );
        assert_eq!(cmp["outcomes"], json!([s(l, "outcome"), s(a, "outcome")]));
        for m in METRICS {
            let d = &cmp["metrics"][m];
            assert_eq!(
                num(d, "legacy"),
                num(l, m),
                "{m}: legacy value is the legacy cell's"
            );
            assert_eq!(
                num(d, "archetypes"),
                num(a, m),
                "{m}: archetypes value is the archetypes cell's"
            );
            match rel(num(l, m), num(a, m)) {
                None => assert!(d["rel_delta"].is_null(), "{m}: undefined delta is null"),
                Some(x) => assert!(
                    (num(d, "rel_delta") - x).abs() < 1e-9,
                    "{m}: rel_delta {} != {x}",
                    d["rel_delta"]
                ),
            }
        }
    }
}

#[test]
fn the_band_is_a_named_constant_and_out_of_band_cells_are_listed() {
    let src = include_str!("../src/bin/camp_bench.rs");
    assert!(
        src.contains("const BAND: f64 = 0.10;"),
        "the +/-10% band must be the named constant `const BAND: f64 = 0.10;` in src/bin/camp_bench.rs"
    );
    let r = &baseline().1;
    validate_report(r, true).expect("complete report first");
    assert_eq!(
        r["band"].as_f64(),
        Some(BAND_REL),
        "the report states the band it used"
    );
    // Recompute the listing: per scenario in order, "outcome" first when the outcomes differ, then each metric whose
    // relative delta is undefined or has |delta| > BAND (a delta of exactly BAND is in band).
    let mut want: Vec<[String; 4]> = Vec::new();
    for cmp in r["comparisons"].as_array().unwrap() {
        let id = |m: &str| {
            [
                s(cmp, "faction").to_string(),
                s(cmp, "weapon").to_string(),
                s(cmp, "kind").to_string(),
                m.to_string(),
            ]
        };
        if cmp["outcomes"][0] != cmp["outcomes"][1] {
            want.push(id("outcome"));
        }
        for m in METRICS {
            let d = &cmp["metrics"][m];
            let out = match rel(num(d, "legacy"), num(d, "archetypes")) {
                None => true,
                Some(x) => x.abs() > BAND_REL,
            };
            if out {
                want.push(id(m));
            }
        }
    }
    let got: Vec<[String; 4]> = r["out_of_band"]
        .as_array()
        .expect("out_of_band is an array")
        .iter()
        .map(|e| {
            [
                s(e, "faction").to_string(),
                s(e, "weapon").to_string(),
                s(e, "kind").to_string(),
                s(e, "metric").to_string(),
            ]
        })
        .collect();
    assert_eq!(
        got, want,
        "out_of_band lists exactly the cells outside the band, in scenario then metric order"
    );
}

#[test]
fn a_changed_weapon_changes_the_cells_it_touches_and_only_those() {
    // Test-only control: run every cell labelled `sword` with the AXE instead (the bench's hidden flag
    // `--control-weapon-swap from=to`). A rule number cannot be edited without touching rh-sim, so the equivalent
    // control is to change the weapon the fighter really wields.
    let t = ticks_arg();
    let ctl = run(&[
        "--quick",
        "--seed",
        "1",
        "--max-ticks",
        &t,
        "--control-weapon-swap",
        "sword=axe",
    ]);
    validate_report(&ctl, true)
        .expect("the control run reports the same inventory (labels unchanged)");
    let base = baseline().1["cells"].as_array().unwrap();
    let cc = ctl["cells"].as_array().unwrap();
    let mut sword_changed = 0;
    for (b, c) in base.iter().zip(cc) {
        assert_eq!(cell_key(b), cell_key(c));
        if s(b, "weapon") == "sword" {
            sword_changed += (b != c) as u32;
        } else {
            assert_eq!(
                b,
                c,
                "{}: a cell whose weapon was not swapped must not change",
                cell_key(b)
            );
        }
    }
    assert!(sword_changed >= 1, "swapping the sword for an axe changed no sword cell: the bench is not measuring the weapon");
}

#[test]
fn frost_chill_and_holy_healing_are_measured() {
    // Oracle assumption (see packet "Oracle assumptions"): over the quick set a Frost fighter chills something and a
    // Holy fighter is healed at least once; a bench that reports a column of zeros is not measuring it.
    let cells = baseline().1["cells"].as_array().unwrap();
    let sum = |f: &str, m: &str| -> f64 {
        cells
            .iter()
            .filter(|c| s(c, "faction") == f)
            .map(|c| num(c, m))
            .sum()
    };
    assert!(
        sum("frost", "chill_seconds") > 0.0,
        "Frost applied no chill/freeze in any quick cell"
    );
    assert!(
        sum("holy", "healing_received") > 0.0,
        "Holy received no healing in any quick cell"
    );
}

/// Slow: the whole inventory in a release build. `cargo test --release -p rh-headless --test camp_bench -- --ignored`
#[test]
#[ignore = "full 1800-cell run; use --release"]
fn full_run_reports_every_cell_and_exits_zero() {
    let r = run(&["--seed", "1"]);
    validate_report(&r, false).expect("the full report passes the checker");
    assert_eq!(r["cells"].as_array().unwrap().len(), 1800);
    assert_eq!(r["comparisons"].as_array().unwrap().len(), 900);
}
