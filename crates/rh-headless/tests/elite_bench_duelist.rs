//! Oracle for packet P-ELITE-BENCH-2 (docs/backlog/packets/P-ELITE-BENCH-2.md): the elite bench with a scripted `duelist`
//! fighter (commits to the target camp, casts its Wish, plays its weapon's range) beside the scripted Brawler (the upper
//! bound), honest outcome accounting (engaged, died, cleared, truncated, no_engage), `--jobs` threads with byte-identical
//! output, three default seeds and truthful caveats.
//!
//! Like `tests/elite_bench.rs` it compiles `src/elite_bench.rs` through `#[path]` and runs the mode in process. Nothing
//! here asserts a balance number: it pins that the duelist is not a Brawler in disguise, that the books balance, that
//! threads do not change a byte, and that the report says what its fighters are. P-ELITE-BENCH-1's oracle stays as it is
//! (a run without `--fighter` is the Brawler run it always was).
#[path = "../src/elite_bench.rs"]
mod elite_bench;

use elite_bench::{parse_options, run, FighterChoice, OWNER_DEFAULT_SEEDS};
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::OnceLock;

const COLUMNS: [&str; 5] = [
    "banked_0",
    "banked_6",
    "banked_12",
    "banked_18",
    "bot_sample",
];
/// What the Brawler can emit (`rh-policy/src/scripted.rs:71-140`).
const BRAWLER_KINDS: [&str; 3] = ["Move", "Attack", "Plan"];

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn args(a: &[&str]) -> Vec<String> {
    a.iter().map(|s| s.to_string()).collect()
}
fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str()
        .unwrap_or_else(|| panic!("field {k} missing or not a string in {v}"))
}
fn u(v: &Value, k: &str) -> u64 {
    v[k].as_u64()
        .unwrap_or_else(|| panic!("field {k} missing or not an integer in {v}"))
}
fn arr<'a>(v: &'a Value, k: &str) -> &'a Vec<Value> {
    v[k].as_array()
        .unwrap_or_else(|| panic!("field {k} missing or not an array in {v}"))
}

fn go(a: &[&str]) -> (String, Value, String) {
    let out = run(&args(a)).unwrap_or_else(|e| panic!("{a:?} reports: {e}"));
    let v = serde_json::from_str(&out.json).expect("the report is one JSON document");
    (out.json, v, out.table)
}

/// The shared run of both fighters: quick, one seed, 1200 ticks. The quick kinds (the zone-0 elites) die in 175-900 ticks,
/// before the Wish unlocks (45 s, about tick 900: `abilities::WISH_LOCK_MS`), so no cast is expected here; the long run
/// below covers casts.
fn both() -> &'static (String, Value, String) {
    static B: OnceLock<(String, Value, String)> = OnceLock::new();
    B.get_or_init(|| {
        go(&[
            "--quick",
            "--seed",
            "1",
            "--seeds",
            "1",
            "--max-ticks",
            "1200",
            "--fighter",
            "both",
            "--jobs",
            "2",
        ])
    })
}

/// A long-fight sweep of the duelist: the glacialWarden camp (fights of 700-1500 ticks, past the Wish lock) with the ranged
/// weapons, Frost and Holy (the quick factions), the five columns, one seed, the default 1800-tick cap. 20 fights.
/// `--kind` and `--weapon` (comma lists of elite kinds and weapons) override the quick sweep's zone and weapons.
fn long() -> &'static (String, Value, String) {
    static L: OnceLock<(String, Value, String)> = OnceLock::new();
    L.get_or_init(|| {
        go(&[
            "--quick",
            "--kind",
            "glacialWarden",
            "--weapon",
            "bow,wand",
            "--seed",
            "1",
            "--seeds",
            "1",
            "--max-ticks",
            "1800",
            "--fighter",
            "duelist",
            "--jobs",
            "2",
        ])
    })
}

fn cells_of<'a>(r: &'a Value, fighter: &str) -> Vec<&'a Value> {
    arr(r, "cells")
        .iter()
        .filter(|c| s(c, "fighter") == fighter)
        .collect()
}

// ---- flags -----------------------------------------------------------------------------------------------------------

#[test]
fn the_flags_default_to_three_seeds_all_cores_and_the_brawler() {
    assert_eq!(
        OWNER_DEFAULT_SEEDS, 3,
        "the owner command runs three world seeds"
    );
    let o = parse_options(&[]).expect("no flags parse");
    assert_eq!(o.seeds, 3);
    assert!(!o.quick);
    assert_eq!(
        o.fighter,
        FighterChoice::Brawler,
        "a run without --fighter is P-ELITE-BENCH-1's Brawler run (its oracle stays green)"
    );
    assert_eq!(o.seed0, 1);
    assert_eq!(o.max_ticks, 1800);
    let cores = std::thread::available_parallelism().map_or(1, |n| n.get());
    assert_eq!(o.jobs, cores, "--jobs defaults to available_parallelism");
    assert_eq!(
        parse_options(&args(&["--quick"])).unwrap().seeds,
        1,
        "a quick run keeps one seed"
    );
    assert_eq!(parse_options(&args(&["--seeds", "5"])).unwrap().seeds, 5);
    assert_eq!(
        parse_options(&args(&["--fighter", "both"]))
            .unwrap()
            .fighter,
        FighterChoice::Both
    );
    assert_eq!(
        parse_options(&args(&["--fighter", "duelist"]))
            .unwrap()
            .fighter,
        FighterChoice::Duelist
    );
    assert_eq!(
        parse_options(&args(&["--fighter", "brawler"]))
            .unwrap()
            .fighter,
        FighterChoice::Brawler
    );
    assert_eq!(parse_options(&args(&["--jobs", "3"])).unwrap().jobs, 3);
    for bad in [
        &["--fighter", "wizard"][..],
        &["--fighter"],
        &["--jobs", "0"],
        &["--jobs", "x"],
        &["--jobs"],
    ] {
        assert!(parse_options(&args(bad)).is_err(), "{bad:?} is refused");
        assert!(run(&args(bad)).is_err(), "{bad:?} is refused by run");
    }
    for bad in [
        &["--quick", "--kind", "nonesuch"][..],
        &["--quick", "--weapon", "spear"],
    ] {
        assert!(run(&args(bad)).is_err(), "{bad:?} is refused by run");
    }
}

#[test]
fn a_run_without_the_fighter_flag_is_the_brawler_run() {
    let a = go(&["--quick", "--seeds", "1", "--max-ticks", "1"]);
    let b = go(&[
        "--quick",
        "--seeds",
        "1",
        "--max-ticks",
        "1",
        "--fighter",
        "brawler",
    ]);
    assert_eq!(a.0, b.0, "same bytes with the flag spelled out");
    assert_eq!(a.2, b.2);
    let r = &a.1;
    assert_eq!(r["fighter"], "brawler");
    assert_eq!(r["reference_fighter"], "brawler");
    assert_eq!(r["reference"], "banked_12");
    assert!(
        r.get("upper_bound").is_none(),
        "one fighter, no upper-bound block"
    );
    assert!(r.get("duelist").is_none(), "no duelist in a Brawler run");
    assert!(arr(r, "cells")
        .iter()
        .all(|c| s(c, "fighter") == "brawler" && c["engaged"] == true && c["actions"].is_object()));
}

// ---- the duelist is not a Brawler in disguise ------------------------------------------------------------------------

#[test]
fn the_brawler_emits_only_move_and_attack_and_never_casts() {
    let (_, r, _) = both();
    assert_eq!(r["fighter"], "both");
    let duel = cells_of(r, "duelist");
    let brawl = cells_of(r, "brawler");
    assert!(
        !duel.is_empty() && duel.len() == brawl.len(),
        "same places, one fight per fighter"
    );
    let kinds = |cs: &[&Value]| -> BTreeSet<String> {
        cs.iter()
            .flat_map(|c| {
                c["actions"]
                    .as_object()
                    .expect("actions object")
                    .keys()
                    .cloned()
            })
            .collect()
    };
    let bk = kinds(&brawl);
    assert!(
        bk.iter().all(|k| BRAWLER_KINDS.contains(&k.as_str())),
        "the Brawler emits only {BRAWLER_KINDS:?}, saw {bk:?}"
    );
    assert!(
        brawl
            .iter()
            .any(|c| c["actions"]["Attack"].as_u64().unwrap_or(0) > 0),
        "the Brawler swings in some fight"
    );
    // Counts are real counts.
    assert!(duel
        .iter()
        .flat_map(|c| c["actions"].as_object().unwrap().values())
        .all(|n| n.as_u64().is_some()));
}

#[test]
fn the_duelist_casts_its_wish_once_it_unlocks() {
    let (_, r, _) = long();
    let duel = cells_of(r, "duelist");
    assert_eq!(duel.len(), arr(r, "cells").len(), "a duelist-only run");
    assert_eq!(
        duel.len(),
        (4 - arr(r, "skipped").len()) * 5,
        "Frost,Holy x bow,wand x one kind x 5 columns"
    );
    let casts = |c: &Value| c["actions"]["Cast"].as_u64().unwrap_or(0);
    // `Aim` alone would not count: an ability cast (the Wish: `PublicCommand::Cast`) is required. Measured (prototype, this
    // run, 20 fights): the 7 fights that last 1000 ticks or more all cast (Frost's Freeze on the target, Holy's Last Stand
    // on itself); of the 13 shorter ones (375-999 ticks) only those past tick 900 cast. Nothing casts before tick 900.
    let long_fights: Vec<_> = duel.iter().filter(|c| u(c, "ticks") >= 1000).collect();
    assert!(
        long_fights.len() >= 4,
        "floor: fights past the Wish lock exist ({})",
        long_fights.len()
    );
    for c in &long_fights {
        assert!(
            casts(c) >= 1,
            "a duelist fight of {} ticks casts its Wish: {c}",
            u(c, "ticks")
        );
    }
    for c in &duel {
        if casts(c) > 0 {
            assert!(u(c, "ticks") >= 900, "the Wish is locked for 45 s: {c}");
        }
    }
    // Both target kinds: Frost's Freeze (Unit) and Holy's Last Stand (Self_) are cast.
    for faction in ["frost", "holy"] {
        assert!(
            duel.iter()
                .any(|c| s(c, "faction") == faction && casts(c) >= 1),
            "{faction} casts its Wish somewhere in the sweep"
        );
    }
}

#[test]
fn a_ranged_duelist_fights_from_much_further_than_the_brawler() {
    let (_, r, _) = both();
    // Pool the wand fights (the quick sweep's ranged weapon) of each fighter: mean over fights that attacked, of the
    // per-fight mean distance to the nearest living camp member on the ticks the fighter submitted an Attack.
    let mean = |fighter: &str, weapon: &str| -> (f64, usize) {
        let v: Vec<f64> = cells_of(r, fighter)
            .into_iter()
            .filter(|c| s(c, "weapon") == weapon && u(c, "attack_ticks") > 0)
            .map(|c| c["attack_dist_mean"].as_f64().expect("attack_dist_mean"))
            .collect();
        (v.iter().sum::<f64>() / v.len().max(1) as f64, v.len())
    };
    let (dw, dn) = mean("duelist", "wand");
    let (bw, bn) = mean("brawler", "wand");
    assert!(
        dn >= 8 && bn >= 8,
        "floor: wand fights that attacked ({dn}, {bn})"
    );
    // Measured with the stand-and-shoot rule (no step back), quick sweep, 1200 ticks, 20 wand fights per fighter: duelist
    // 202 u vs Brawler 50 u (4.1x, gap 152 u). The floors sit below that and above "no standing off" (ratio 1).
    assert!(
        dw >= 2.5 * bw && dw - bw >= 100.,
        "a wand duelist attacks from about 0.8 of its range: duelist {dw:.1} u vs Brawler {bw:.1} u"
    );
    // Melee: the duelist closes to its reach, it does not hang back (reach 112 u for the sword).
    let (ds, sn) = mean("duelist", "sword");
    assert!(sn >= 8);
    assert!(
        ds <= 112.,
        "a sword duelist attacks within its reach: {ds:.1} u"
    );
    // Cells without an attack report no mean (not 0).
    for c in arr(r, "cells") {
        assert_eq!(
            c["attack_dist_mean"].is_null(),
            u(c, "attack_ticks") == 0,
            "{c}"
        );
    }
}

#[test]
fn the_duelist_commits_to_the_fight() {
    let (_, r, _) = both();
    let duel = cells_of(r, "duelist");
    let no_engage = duel
        .iter()
        .filter(|c| s(c, "outcome") == "no_engage")
        .count();
    // Measured: 0 of 32 (the duelist walks to its camp, unlike a roaming bot). Allow a tenth.
    assert!(
        no_engage * 10 <= duel.len(),
        "the duelist engages its camp: {no_engage} no_engage of {}",
        duel.len()
    );
    assert!(duel.iter().any(|c| c["engaged"] == true));
}

// ---- outcome accounting ------------------------------------------------------------------------------------------------

fn wilson(d: f64, n: f64) -> [f64; 2] {
    let (p, z) = (d / n, 1.959_963_984_540_054);
    let denom = 1. + z * z / n;
    let centre = (p + z * z / (2. * n)) / denom;
    let half = z * (p * (1. - p) / n + z * z / (4. * n * n)).sqrt() / denom;
    [(centre - half).max(0.), (centre + half).min(1.)]
}

/// One `columns[]` block against the cells it summarises.
fn check_columns(columns: &Value, cells: &[&Value], what: &str) {
    let cols = columns
        .as_array()
        .unwrap_or_else(|| panic!("{what}: columns array"));
    assert_eq!(cols.len(), 5, "{what}: five columns");
    for (col, name) in cols.iter().zip(COLUMNS) {
        assert_eq!(s(col, "column"), name, "{what}");
        let mine: Vec<&&Value> = cells.iter().filter(|c| s(c, "column") == name).collect();
        let count = |o: &str| mine.iter().filter(|c| s(c, "outcome") == o).count() as u64;
        let (samples, engaged) = (u(col, "samples"), u(col, "engaged"));
        let (died, cleared, truncated, none) = (
            u(col, "deaths"),
            u(col, "cleared"),
            u(col, "truncated"),
            u(col, "no_engage"),
        );
        let ctx = format!("{what} {name}: {col}");
        assert_eq!(samples, mine.len() as u64, "{ctx}");
        assert_eq!(died, count("died"), "{ctx}");
        assert_eq!(cleared, count("cleared"), "{ctx}");
        assert_eq!(truncated, count("truncated"), "{ctx}");
        assert_eq!(none, count("no_engage"), "{ctx}");
        assert_eq!(
            mine.iter().filter(|c| c["engaged"] == true).count() as u64,
            engaged,
            "{ctx}"
        );
        assert_eq!(
            engaged + none,
            samples,
            "{ctx}: engaged + no_engage == samples"
        );
        assert_eq!(
            died + cleared + truncated,
            engaged,
            "{ctx}: died + cleared + truncated == engaged"
        );
        if engaged == 0 {
            assert!(
                col["death_rate"].is_null(),
                "{ctx}: no engaged fight, no rate (not 0)"
            );
            assert!(col["clear_rate"].is_null(), "{ctx}");
            assert!(col["ci95"].is_null(), "{ctx}");
        } else {
            let e = engaged as f64;
            let dr = col["death_rate"].as_f64().expect("death_rate");
            let cr = col["clear_rate"].as_f64().expect("clear_rate");
            assert!(
                (dr - died as f64 / e).abs() < 1e-12,
                "{ctx}: death rate is died / engaged"
            );
            assert!(
                (cr - cleared as f64 / e).abs() < 1e-12,
                "{ctx}: clear rate is cleared / engaged"
            );
            let ci = col["ci95"].as_array().expect("ci95");
            let w = wilson(died as f64, e);
            assert!(
                (ci[0].as_f64().unwrap() - w[0]).abs() < 1e-9
                    && (ci[1].as_f64().unwrap() - w[1]).abs() < 1e-9,
                "{ctx}: the Wilson interval is over engaged fights"
            );
        }
    }
}

#[test]
fn per_column_books_balance_for_both_fighters() {
    let (_, r, _) = both();
    let live = cells_of(r, "duelist");
    let brawl = cells_of(r, "brawler");
    // Cell-level rules.
    for c in &live {
        let engaged = c["engaged"] == true;
        assert_eq!(
            s(c, "outcome") == "no_engage",
            !engaged,
            "duelist: no_engage iff not engaged: {c}"
        );
        assert!(
            ["died", "cleared", "truncated", "no_engage"].contains(&s(c, "outcome")),
            "{c}"
        );
        if s(c, "outcome") == "died" {
            assert_eq!(c["hp_remaining"].as_f64(), Some(0.), "{c}");
        }
    }
    for c in &brawl {
        assert_eq!(
            c["engaged"], true,
            "every Brawler fight counts as engaged (as in P-ELITE-BENCH-1)"
        );
        assert!(
            ["died", "cleared", "truncated"].contains(&s(c, "outcome")),
            "{c}"
        );
    }
    // Overall and per camp, for the reference fighter (top level) and the upper bound.
    assert_eq!(r["reference_fighter"], "duelist");
    assert_eq!(r["reference"], "banked_12");
    check_columns(&r["overall"]["columns"], &live, "duelist overall");
    for p in arr(r, "per_camp") {
        let mine: Vec<&Value> = live
            .iter()
            .copied()
            .filter(|c| c["kind"] == p["kind"])
            .collect();
        check_columns(&p["columns"], &mine, &format!("duelist {}", s(p, "kind")));
        let refcol = &p["columns"][2];
        assert_eq!(
            p["samples"], refcol["samples"],
            "per_camp reports the reference column"
        );
        assert_eq!(p["deaths"], refcol["deaths"]);
        assert_eq!(p["death_rate"], refcol["death_rate"]);
    }
    let ub = &r["upper_bound"];
    assert_eq!(ub["fighter"], "brawler");
    check_columns(&ub["overall"]["columns"], &brawl, "brawler overall");
    let ub_camps = arr(ub, "per_camp");
    assert_eq!(ub_camps.len(), arr(r, "per_camp").len());
    for p in ub_camps {
        let mine: Vec<&Value> = brawl
            .iter()
            .copied()
            .filter(|c| c["kind"] == p["kind"])
            .collect();
        check_columns(&p["columns"], &mine, &format!("brawler {}", s(p, "kind")));
    }
    // For the Brawler engaged == samples, so its rates are P-ELITE-BENCH-1's.
    for col in arr(&ub["overall"], "columns") {
        assert_eq!(col["engaged"], col["samples"]);
        assert_eq!(col["no_engage"], 0);
    }
}

#[test]
fn a_column_with_no_engaged_fight_reports_no_rate_not_zero() {
    // One tick: nobody can reach a camp 128-320 u away, so every duelist fight is no_engage.
    let (_, r, table) = go(&[
        "--quick",
        "--seeds",
        "1",
        "--max-ticks",
        "1",
        "--fighter",
        "duelist",
        "--jobs",
        "2",
    ]);
    let cells = arr(&r, "cells");
    assert!(!cells.is_empty());
    assert!(cells.iter().all(|c| s(c, "outcome") == "no_engage"
        && c["engaged"] == false
        && s(c, "fighter") == "duelist"));
    let refs: Vec<&Value> = cells.iter().collect();
    check_columns(&r["overall"]["columns"], &refs, "no engagement");
    for col in arr(&r["overall"], "columns") {
        assert_eq!(col["engaged"], 0);
        assert!(col["death_rate"].is_null() && col["ci95"].is_null());
    }
    assert!(
        r["overall"]["death_rate"].is_null(),
        "overall reports no rate"
    );
    assert!(
        table.contains("n/a"),
        "the table prints n/a, not 0.0%: {table}"
    );
    assert!(!table.contains("0.0%"), "{table}");
}

// ---- seeds and threads ----------------------------------------------------------------------------------------------

#[test]
fn cells_carry_their_world_seed_over_three_seeds() {
    let (_, r, _) = go(&[
        "--quick",
        "--seed",
        "1",
        "--seeds",
        "3",
        "--max-ticks",
        "1",
        "--fighter",
        "duelist",
        "--jobs",
        "3",
    ]);
    let seeds: BTreeSet<u64> = arr(&r, "cells").iter().map(|c| u(c, "seed")).collect();
    assert_eq!(seeds, BTreeSet::from([1, 2, 3]), "three world seeds fought");
    // 2 factions x 2 weapons x 2 kinds x 3 seeds places; each fought place is 5 columns of one fighter.
    let skipped = arr(&r, "skipped").len();
    assert_eq!(arr(&r, "cells").len(), (24 - skipped) * 5);
    // Within a seed the order is faction, weapon, kind, seed, column (duelist only here): seed is non-decreasing inside
    // a (faction, weapon, kind) group.
    let mut last: Option<(String, String, String, u64)> = None;
    for c in arr(&r, "cells") {
        let key = (
            s(c, "faction").to_string(),
            s(c, "weapon").to_string(),
            s(c, "kind").to_string(),
            u(c, "seed"),
        );
        if let Some(l) = &last {
            if (&l.0, &l.1, &l.2) == (&key.0, &key.1, &key.2) {
                assert!(l.3 <= key.3, "seed is the innermost place key");
            }
        }
        last = Some(key);
    }
}

#[test]
fn the_output_is_byte_identical_for_any_jobs() {
    let a = [
        "--quick",
        "--seeds",
        "2",
        "--max-ticks",
        "60",
        "--fighter",
        "both",
    ];
    let run_with = |jobs: &str| {
        let mut v = a.to_vec();
        v.extend(["--jobs", jobs]);
        go(&v)
    };
    let one = run_with("1");
    let four = run_with("4");
    assert_eq!(one.0, four.0, "JSON differs between --jobs 1 and --jobs 4");
    assert_eq!(one.2, four.2, "table differs between --jobs 1 and --jobs 4");
    assert!(
        !one.0.contains("\"jobs\""),
        "jobs is not part of the report"
    );
    assert!(!arr(&one.1, "cells").is_empty());
    // Threads are std threads in rh-headless only.
    let src = include_str!("../src/elite_bench.rs");
    assert!(src.contains("available_parallelism"));
    assert!(src.contains("std::thread"));
    assert!(
        !src.contains("HashMap"),
        "no hash-ordered collection where output order matters"
    );
}

// ---- report shape and honesty ----------------------------------------------------------------------------------------

#[test]
fn rows_exist_per_fighter_in_cell_order() {
    let (_, r, _) = both();
    let cells = arr(r, "cells");
    let skipped = arr(r, "skipped").len();
    // 2 factions x 2 weapons x 2 kinds x 1 seed places; each fought place has 2 fighters x 5 columns.
    assert_eq!(cells.len(), (8 - skipped) * 10);
    for place in cells.chunks(10) {
        let key = |c: &Value| {
            (
                s(c, "faction").to_string(),
                s(c, "weapon").to_string(),
                s(c, "kind").to_string(),
                u(c, "seed"),
            )
        };
        assert!(
            place.iter().all(|c| key(c) == key(&place[0])),
            "one place per ten cells"
        );
        let order: Vec<(&str, &str)> = place
            .iter()
            .map(|c| (s(c, "fighter"), s(c, "column")))
            .collect();
        let want: Vec<(&str, &str)> = ["duelist", "brawler"]
            .into_iter()
            .flat_map(|f| COLUMNS.map(|c| (f, c)))
            .collect();
        assert_eq!(
            order, want,
            "duelist first, then the Brawler, five columns each"
        );
        // Same fight setup for both fighters of a place: same camp, start and build index.
        for i in 0..5 {
            for k in ["camp", "start_dist", "camps", "build_index", "seed"] {
                assert_eq!(
                    place[i][k],
                    place[i + 5][k],
                    "{k} is shared by the two fighters"
                );
            }
        }
    }
    assert!(!r["upper_bound"]["per_camp"].is_null());
}

#[test]
fn the_caveat_and_table_say_what_the_fighters_are() {
    let (_, r, table) = both();
    let caveat = s(r, "caveat");
    for want in [
        "Brawler",
        "upper bound",
        "duelist",
        "ci95",
        "faction",
        "weapon",
        "seed",
        "camp placement",
        "no_engage",
        "truncated",
        "retreat",
        "give-up",
        "reset",
        "decided",
    ] {
        assert!(caveat.contains(want), "the caveat names {want:?}: {caveat}");
    }
    assert!(
        table.contains("upper bound"),
        "the table names the Brawler rows as the upper bound"
    );
    assert!(table.contains("Brawler"));
    let reference = table
        .lines()
        .find(|l| l.contains("reference"))
        .unwrap_or_else(|| panic!("a reference line: {table}"));
    assert!(
        reference.contains("duelist") && reference.contains("banked_12"),
        "the reference is duelist banked_12: {reference}"
    );
    assert!(table.contains("10-20%"), "the owner target is printed");
    // One count line per fighter and column, equal to the JSON overall tallies.
    for (fighter, overall) in [
        ("duelist", &r["overall"]),
        ("brawler", &r["upper_bound"]["overall"]),
    ] {
        for col in arr(overall, "columns") {
            let name = s(col, "column");
            let prefix = format!("  counts {fighter} {name}:");
            let line = table
                .lines()
                .find(|l| l.starts_with(&prefix))
                .unwrap_or_else(|| panic!("a line starting {prefix:?} in:\n{table}"));
            let want = format!(
                "samples={} engaged={} died={} cleared={} truncated={} no_engage={}",
                u(col, "samples"),
                u(col, "engaged"),
                u(col, "deaths"),
                u(col, "cleared"),
                u(col, "truncated"),
                u(col, "no_engage")
            );
            assert_eq!(line[prefix.len()..].trim(), want, "{line}");
        }
    }
}

#[test]
fn the_readme_documents_the_duelist_the_owner_command_and_the_limits() {
    let text = std::fs::read_to_string(root().join("tools/balance-camps/README.md")).unwrap();
    for want in [
        "--fighter both",
        "--jobs",
        "duelist",
        "upper bound",
        "no_engage",
        "truncated",
        "ci95",
        "duelist",
        "banked_12",
        "decided",
        "resets",
        "give-up",
    ] {
        assert!(text.contains(want), "README names {want:?}");
    }
    assert!(
        !text.contains("rates are \"Brawler with weapon W\"") || text.contains("upper bound"),
        "the Brawler line is no longer the whole story"
    );
}

// ---- the give-up rule: a ranged fighter must not reset the camp ---------------------------------------------------------

#[test]
fn a_ranged_duelist_stands_and_shoots_so_fights_are_decided_not_truncated() {
    // Legacy: a fighting mob gives up after 20 s without hitting a player (`MOB_GIVE_UP_SECONDS`, rh-sim
    // `systems/mob_ai.rs:266`; `last_combat_at` is refreshed only when a mob hits a player, `ledger.rs:1218`) and in Return
    // mode regenerates to full in 2 s (`mob_life.rs:605-616`). A duelist that steps back to stay out of reach goes unhit
    // for 20 s and the camp resets: pure kiting truncated half of the owner run's ranged fights. The duelist therefore
    // walks to 0.8 x range and stands there. (Legacy behaviour, not a sim defect.)
    let (_, r, _) = long();
    let ranged: Vec<&Value> = cells_of(r, "duelist")
        .into_iter()
        .filter(|c| ["bow", "wand"].contains(&s(c, "weapon")))
        .collect();
    assert_eq!(ranged.len(), arr(r, "cells").len());
    assert!(
        ranged.len() >= 16,
        "floor: ranged fights ({})",
        ranged.len()
    );
    let truncated = ranged
        .iter()
        .filter(|c| s(c, "outcome") == "truncated")
        .count();
    // Measured with the stand-and-shoot rule: 0 of 20 truncated (bow 0 of 10, wand 0 of 10). The same sweep with the step
    // back rule: wand 10 of 10 truncated (or no_engage). The floor (15%) is far from both.
    assert!(
        truncated * 100 <= 15 * ranged.len(),
        "ranged duelist fights are decided: {truncated} truncated of {}",
        ranged.len()
    );
    let banked12: Vec<_> = ranged
        .iter()
        .filter(|c| s(c, "column") == "banked_12")
        .collect();
    assert!(banked12.iter().all(|c| s(c, "outcome") != "truncated"));
}

#[test]
fn a_ranged_duelist_does_not_reset_the_camp() {
    // `resets` per cell: the number of times a living member of the target camp left fight mode (gave up, returned, healed
    // to full) while the fighter was alive and the camp not yet cleared; measured from sim truth by the bench. The owner
    // run's step-back duelist did it often; the stand-and-shoot one measured 0 in both sweeps below (and 7% of wand fights
    // in the full 1500-fight sweep). Allow a tenth of the fights.
    for (name, run_) in [("long", long()), ("quick", both())] {
        let (_, r, _) = run_;
        for c in arr(r, "cells") {
            assert!(c["resets"].is_u64(), "{name}: resets on every cell: {c}");
        }
        let ranged: Vec<&Value> = cells_of(r, "duelist")
            .into_iter()
            .filter(|c| ["bow", "wand"].contains(&s(c, "weapon")))
            .collect();
        assert!(ranged.len() >= 16, "{name}: floor ({})", ranged.len());
        let with = ranged.iter().filter(|c| u(c, "resets") > 0).count();
        assert!(
            with * 10 <= ranged.len(),
            "{name}: {with} of {} ranged duelist fights reset the camp",
            ranged.len()
        );
    }
}

// ---- per weapon, and the decided rate ---------------------------------------------------------------------------------------

#[test]
fn the_per_weapon_block_exists_and_its_books_balance() {
    let (_, r, _) = both();
    let rows = arr(r, "by_weapon");
    // duelist then Brawler; weapons in `WeaponId::ALL` order (sword before wand); the five columns innermost.
    assert_eq!(rows.len(), 2 * 2 * 5);
    let want: Vec<(&str, &str, &str)> = ["duelist", "brawler"]
        .into_iter()
        .flat_map(|f| {
            ["sword", "wand"]
                .into_iter()
                .flat_map(move |w| COLUMNS.map(|c| (f, w, c)))
        })
        .collect();
    let got: Vec<(&str, &str, &str)> = rows
        .iter()
        .map(|x| (s(x, "fighter"), s(x, "weapon"), s(x, "column")))
        .collect();
    assert_eq!(got, want);
    for chunk in rows.chunks(5) {
        let (f, w) = (s(&chunk[0], "fighter"), s(&chunk[0], "weapon"));
        let cells: Vec<&Value> = cells_of(r, f)
            .into_iter()
            .filter(|c| s(c, "weapon") == w)
            .collect();
        assert!(!cells.is_empty());
        check_columns(&Value::Array(chunk.to_vec()), &cells, &format!("{f} {w}"));
    }
}

#[test]
fn the_table_prints_the_decided_rate_beside_the_headline() {
    let (_, r, table) = both();
    let pct = |rate: &Value| {
        rate.as_f64()
            .map_or("n/a".to_string(), |x| format!("{:.1}%", 100. * x))
    };
    for (fighter, overall) in [
        ("duelist", &r["overall"]),
        ("brawler", &r["upper_bound"]["overall"]),
    ] {
        for col in arr(overall, "columns") {
            let name = s(col, "column");
            let prefix = format!("  decided {fighter} {name}:");
            let line = table
                .lines()
                .find(|l| l.starts_with(&prefix))
                .unwrap_or_else(|| panic!("a line starting {prefix:?} in:\n{table}"));
            let want = format!(
                "died={} cleared={} rate={}",
                u(col, "deaths"),
                u(col, "cleared"),
                pct(&col["decided_rate"])
            );
            assert_eq!(line[prefix.len()..].trim(), want, "{line}");
        }
    }
    // The reference column, per weapon.
    for row in arr(r, "by_weapon")
        .iter()
        .filter(|x| s(x, "column") == "banked_12")
    {
        let prefix = format!(
            "  weapon {} {} banked_12:",
            s(row, "fighter"),
            s(row, "weapon")
        );
        let line = table
            .lines()
            .find(|l| l.starts_with(&prefix))
            .unwrap_or_else(|| panic!("a line starting {prefix:?} in:\n{table}"));
        let want = format!(
            "died={} cleared={} truncated={} rate={}",
            u(row, "deaths"),
            u(row, "cleared"),
            u(row, "truncated"),
            pct(&row["decided_rate"])
        );
        assert_eq!(line[prefix.len()..].trim(), want, "{line}");
    }
}
