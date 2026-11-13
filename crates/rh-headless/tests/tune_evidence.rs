//! P-BOT-TUNER-2 oracle: the search's output can tell an improvement from noise.
//!
//! Pinned here: per tier the wins and games with a Wilson interval (the tournament report's `Proportion`) for the
//! shipped tables and for the best table, plus the persona spread; a held-out re-score on a tournament seed the search
//! never used (refused when it equals a search seed); one verdict per tier ("better": the best table's interval lies
//! wholly above the baseline's, i.e. best.lo > baseline.hi; "worse": best.hi < baseline.lo; otherwise "not
//! distinguishable"); byte-identical files on 1 and 2 workers; and that the search itself and the existing fields of its
//! file do not move. Also the plan's tables reaching the tournament report's reaction and APM columns
//! (`aggregate_with`, additive: `aggregate` and the existing tests are untouched).
use rh_headless::tournament::{
    aggregate, aggregate_with, default_sim_config, play, sim_config_for, wilson, GameSummary,
    Proportion, TournamentPlan,
};
use rh_headless::tournament_cli::default_arena;
use rh_headless::tournament_learning::SeatPolicy;
use rh_headless::tune::{
    apply_tune, check_held_out_seed, compare_tables, evidence, persona_spread, play_tuned, search,
    search_file, search_file_with_evidence, table_file, verdict, SearchConfig, Verdict,
};
use rh_policy::bots::types::BrainTables;
use rh_policy::bots::TierId;
use rh_sim::arenas::practice_arena;
use rh_sim::{ArenaMode, ArenaRules, SimConfig};
use serde_json::{json, Value};

const TIERS: [&str; 3] = ["easy", "normal", "hard"];
const VERDICTS: [&str; 3] = ["better", "worse", "not distinguishable"];

fn compiled() -> BrainTables {
    BrainTables::COMPILED
}

fn fast_config() -> SimConfig {
    SimConfig {
        lifecycle: ArenaMode::Source(ArenaRules {
            plan_seconds: 0.,
            first_patience_seconds: None,
            coliseum_schedule: None,
            patience_seconds: 3.,
            patience_min_seconds: 2.,
            sudden_death_seconds: 2.,
        }),
        ..default_sim_config()
    }
}

fn tiny_plan(games: u32) -> TournamentPlan {
    TournamentPlan::with_tiers(
        games,
        7,
        vec![TierId::Easy, TierId::Normal, TierId::Hard],
        60_000.,
    )
}

/// Search seed 5, plan (tournament) seed 7, one generation of one proposal.
fn small_search(workers: u32) -> SearchConfig {
    let mut plan = tiny_plan(1);
    plan.workers = workers;
    SearchConfig {
        seed: 5,
        generations: 1,
        population: 1,
        changes: 3,
        step: 0.25,
        plan,
        policy: SeatPolicy::Human,
        commit: "0123abcd".into(),
    }
}

const HELD_OUT: u32 = 11;

fn pretty(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap()
}

fn fnv1a(text: &str) -> u64 {
    text.bytes().fold(0xcbf29ce484222325, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x100000001b3)
    })
}

/// The evidence file of the small search with a held-out seed.
fn evidence_file(workers: u32, held_out: Option<u32>) -> Value {
    let config = small_search(workers);
    let (arena, sim) = (practice_arena(), fast_config());
    let result = search(&config, &arena, &sim);
    let ev = evidence(&config, &result, &arena, &sim, held_out).expect("a valid held-out seed");
    search_file_with_evidence(&config, &result, &ev)
}

/// One `{wins, games, p, lo, hi}` block: consistent with the Wilson interval of wins in games.
fn check_proportion(block: &Value, what: &str) -> Proportion {
    let (k, n) = (
        block["wins"].as_f64().unwrap_or(f64::NAN),
        block["games"].as_f64().unwrap_or(f64::NAN),
    );
    assert!(
        n >= 1. && (0. ..=n).contains(&k),
        "{what}: wins {k} of games {n}"
    );
    let w = wilson(k, n, 1.96);
    for (name, want) in [("p", w.p), ("lo", w.lo), ("hi", w.hi)] {
        let got = block[name].as_f64().unwrap_or(f64::NAN);
        assert!(
            (got - want).abs() < 1e-9,
            "{what}.{name} = {got}, the Wilson interval of {k}/{n} is {want}"
        );
    }
    w
}

/// Every tier of a `tiers` object: both proportions and a verdict that follows the stated rule.
fn check_tiers(tiers: &Value, what: &str) {
    for tier in TIERS {
        let t = &tiers[tier];
        assert!(t.is_object(), "{what}.tiers.{tier} is missing: {tiers}");
        let base = check_proportion(&t["baseline"], &format!("{what}.{tier}.baseline"));
        let best = check_proportion(&t["best"], &format!("{what}.{tier}.best"));
        let rule = if best.lo > base.hi {
            "better"
        } else if best.hi < base.lo {
            "worse"
        } else {
            "not distinguishable"
        };
        assert_eq!(
            t["verdict"], rule,
            "{what}.{tier}: verdict does not follow best.lo > baseline.hi / best.hi < baseline.lo"
        );
    }
}

#[test]
fn the_file_carries_proportions_spreads_held_out_block_and_verdicts() {
    let file = evidence_file(1, Some(HELD_OUT));
    let ev = &file["evidence"];
    assert!(
        ev.is_object(),
        "the file has an `evidence` object: {}",
        file.as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>()
            .join(",")
    );
    assert_eq!(ev["interval"], "wilson 95% (z = 1.96) of per-bot wins");
    // The persona spread, for the shipped tables and for the best table.
    let best = rh_headless::tune::read_table_file(&file["table"]).unwrap();
    assert_eq!(ev["spread"]["baseline"], persona_spread(&compiled()));
    assert_eq!(ev["spread"]["best"], persona_spread(&best));
    // On the search's own plan (in sample).
    check_tiers(&ev["search"]["tiers"], "search");
    // On the held-out seed.
    assert_eq!(ev["heldOut"]["seed"], HELD_OUT);
    check_tiers(&ev["heldOut"]["tiers"], "heldOut");
    // The held-out numbers are what a plain tournament of each table on that seed gives.
    let (arena, sim) = (practice_arena(), fast_config());
    let mut plan = small_search(1).plan;
    plan.seed = HELD_OUT;
    for (label, tables) in [("baseline", compiled()), ("best", best)] {
        let installed: &'static BrainTables = Box::leak(Box::new(tables));
        let games = play_tuned(&plan, &arena, &sim, SeatPolicy::Human, installed);
        for tier in aggregate(&games).tiers {
            let block = &ev["heldOut"]["tiers"][tier.tier.as_str()][label];
            assert_eq!(
                (block["wins"].as_f64(), block["games"].as_f64()),
                (Some(tier.wins), Some(tier.bot_games)),
                "heldOut {} {label}",
                tier.tier.as_str()
            );
        }
    }
}

#[test]
fn without_a_held_out_seed_the_block_is_null_and_the_search_comparison_stays() {
    let file = evidence_file(1, None);
    let ev = &file["evidence"];
    assert!(ev.is_object(), "the file has an `evidence` object");
    assert!(ev["heldOut"].is_null(), "no seed, no held-out block");
    assert!(ev.get("heldOut").is_some(), "the key is present, null");
    check_tiers(&ev["search"]["tiers"], "search");
    assert!(ev["spread"]["best"].as_f64().unwrap() > 0.);
}

#[test]
fn the_verdict_rule_is_wholly_above_wholly_below_else_not_distinguishable() {
    let lots = wilson(20., 20., 1.96);
    let none = wilson(0., 20., 1.96);
    assert_eq!(verdict(&lots, &none), Verdict::Better, "20/20 over 0/20");
    assert_eq!(verdict(&none, &lots), Verdict::Worse, "0/20 under 20/20");
    assert_eq!(
        verdict(&lots, &lots),
        Verdict::NotDistinguishable,
        "identical"
    );
    // Overlapping, and touching (the rule is strict: best.lo must exceed baseline.hi).
    let a = wilson(6., 10., 1.96);
    let b = wilson(4., 10., 1.96);
    assert_eq!(
        verdict(&a, &b),
        Verdict::NotDistinguishable,
        "6/10 vs 4/10 overlap"
    );
    let at = |lo: f64, hi: f64| Proportion {
        k: 1.,
        n: 2.,
        p: (lo + hi) / 2.,
        lo,
        hi,
    };
    assert_eq!(
        verdict(&at(0.5, 0.9), &at(0.1, 0.5)),
        Verdict::NotDistinguishable,
        "touching is not wholly above"
    );
    assert_eq!(
        verdict(&at(0.51, 0.9), &at(0.1, 0.5)),
        Verdict::Better,
        "just above"
    );
    // A tier nobody played (n = 0: NaN interval) is not distinguishable.
    assert_eq!(
        verdict(&wilson(0., 0., 1.96), &lots),
        Verdict::NotDistinguishable
    );
    assert_eq!(Verdict::Better.as_str(), "better");
    assert_eq!(Verdict::Worse.as_str(), "worse");
    assert_eq!(Verdict::NotDistinguishable.as_str(), "not distinguishable");
}

#[test]
fn a_table_equal_to_the_shipped_tables_is_not_distinguishable_on_every_tier() {
    let (arena, sim) = (practice_arena(), fast_config());
    let plan = tiny_plan(2);
    let rows = compare_tables(
        &plan,
        &arena,
        &sim,
        SeatPolicy::Human,
        &compiled(),
        &compiled(),
    );
    assert_eq!(
        rows.iter().map(|r| r.tier).collect::<Vec<_>>(),
        vec![TierId::Easy, TierId::Normal, TierId::Hard],
        "one row per tier of the lineup, in tier order"
    );
    for row in &rows {
        assert_eq!(row.baseline, row.best, "same table, same games: {row:?}");
        assert_eq!(row.baseline.n, 2., "two games, one seat per tier");
        assert_eq!(row.verdict, Verdict::NotDistinguishable, "{row:?}");
    }
}

#[test]
fn a_held_out_seed_equal_to_a_search_seed_is_refused_with_a_message_naming_both() {
    let config = small_search(1);
    // The plan's (scoring) seed.
    let err = check_held_out_seed(&config, 7).expect_err("7 is the scoring tournament seed");
    for part in ["held-out", "7", "--tournament-seed"] {
        assert!(err.contains(part), "message lacks {part:?}: {err}");
    }
    // The search's own seed.
    let err = check_held_out_seed(&config, 5).expect_err("5 is the search seed");
    for part in ["held-out", "5", "--seed"] {
        assert!(err.contains(part), "message lacks {part:?}: {err}");
    }
    assert_eq!(check_held_out_seed(&config, HELD_OUT), Ok(()));
    // `evidence` refuses too, before playing anything.
    let (arena, sim) = (practice_arena(), fast_config());
    let result = search(&config, &arena, &sim);
    assert!(evidence(&config, &result, &arena, &sim, Some(7)).is_err());
}

#[test]
fn one_and_two_workers_write_byte_identical_files() {
    let one = pretty(&evidence_file(1, Some(HELD_OUT)));
    let two = pretty(&evidence_file(2, Some(HELD_OUT)));
    assert!(one.contains("\"heldOut\""), "the evidence is in the file");
    assert_eq!(one, two, "worker count does not move a byte");
}

// ---- guards: green today, must stay green ----

#[test]
fn guard_the_searchs_best_table_and_file_do_not_move() {
    let config = SearchConfig {
        generations: 3,
        population: 2,
        ..small_search(1)
    };
    let (arena, sim) = (practice_arena(), fast_config());
    let result = search(&config, &arena, &sim);
    // At this size no proposal beats the baseline (every candidate ties: no run small enough for the quick gate moved
    // off the shipped tables), so the best table is the shipped one; the file digest below pins every proposal (its
    // changed leaves, so the RNG stream and the bounds) and every score.
    assert_eq!(result.best, compiled(), "pinned as of the oracle commit");
    assert_eq!(
        format!("{:016x}", fnv1a(&pretty(&table_file(&result.best)))),
        BEST_TABLE_DIGEST,
        "the best table of seed 5, plan seed 7, 3 generations x 2 proposals"
    );
    assert_eq!(
        format!("{:016x}", fnv1a(&pretty(&search_file(&config, &result)))),
        SEARCH_FILE_DIGEST,
        "the existing search file"
    );
}

#[test]
fn guard_the_existing_fields_are_unchanged_by_the_evidence() {
    let config = small_search(1);
    let (arena, sim) = (practice_arena(), fast_config());
    let result = search(&config, &arena, &sim);
    let old = search_file(&config, &result);
    let ev = evidence(&config, &result, &arena, &sim, Some(HELD_OUT)).unwrap();
    let new = search_file_with_evidence(&config, &result, &ev);
    for (key, value) in old.as_object().unwrap() {
        assert_eq!(&new[key], value, "existing field {key} changed");
    }
    let extra: Vec<_> = new
        .as_object()
        .unwrap()
        .keys()
        .filter(|k| old.get(k.as_str()).is_none())
        .collect();
    assert!(
        extra.iter().all(|k| *k == "evidence"),
        "the only new top-level key is `evidence`: {extra:?}"
    );
}

// ---- the binary ----

fn tune_bin(out: &std::path::Path, extra: &[&str]) -> std::process::Output {
    std::process::Command::new(env!("CARGO_BIN_EXE_tune"))
        .args([
            "--seed",
            "5",
            "--generations",
            "1",
            "--population",
            "1",
            "--changes",
            "3",
            "--games",
            "1",
            "--lineup",
            "E,N,H",
            "--tournament-seed",
            "7",
            "--policy",
            "human",
            "--max-minutes",
            "1",
            "--patience",
            "3",
            "--sudden",
            "2",
            "--commit",
            "0123abcd",
            "--out",
        ])
        .arg(out)
        .args(extra)
        .output()
        .expect("the tune binary runs")
}

fn scratch(name: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(name)
}

#[test]
fn the_binary_refuses_a_held_out_seed_equal_to_a_search_seed_before_searching() {
    for (seed, flag) in [("7", "--tournament-seed"), ("5", "--seed")] {
        let out = scratch(&format!("tune_evidence_refused_{seed}.json"));
        let _ = std::fs::remove_file(&out);
        let run = tune_bin(&out, &["--held-out-tournament-seed", seed]);
        assert_eq!(run.status.code(), Some(2), "refused, usage exit code");
        let stderr = String::from_utf8_lossy(&run.stderr);
        for part in ["held-out", seed, flag] {
            assert!(stderr.contains(part), "stderr lacks {part:?}: {stderr}");
        }
        assert!(!out.exists(), "nothing is written when the seed is refused");
    }
}

#[test]
fn the_binary_prints_one_verdict_line_per_tier_and_writes_the_block() {
    let out = scratch("tune_evidence_run.json");
    let _ = std::fs::remove_file(&out);
    let run = tune_bin(&out, &["--held-out-tournament-seed", "11"]);
    assert!(
        run.status.success(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    let file: Value = serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
    assert_eq!(file["evidence"]["heldOut"]["seed"], 11);
    check_tiers(&file["evidence"]["heldOut"]["tiers"], "heldOut");
    let stdout = String::from_utf8_lossy(&run.stdout);
    for tier in TIERS {
        let line = stdout
            .lines()
            .find(|l| l.starts_with(&format!("{tier}: ")))
            .unwrap_or_else(|| panic!("a `{tier}: <verdict>` line is on stdout: {stdout}"));
        let said = VERDICTS
            .iter()
            .find(|v| line[tier.len() + 2..].starts_with(**v))
            .unwrap_or_else(|| panic!("no verdict in {line:?}"));
        assert_eq!(
            file["evidence"]["heldOut"]["tiers"][tier]["verdict"], *said,
            "the stdout line says what the file says (held-out)"
        );
    }
}

#[test]
fn guard_without_the_flag_the_binarys_existing_fields_are_the_librarys() {
    let out = scratch("tune_evidence_noflag.json");
    let _ = std::fs::remove_file(&out);
    let run = tune_bin(&out, &[]);
    assert!(
        run.status.success(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    let file: Value = serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
    let mut plan = tiny_plan(1);
    plan.patience_seconds = Some(3.);
    plan.sudden_death_seconds = Some(2.);
    let config = SearchConfig {
        plan,
        ..small_search(1)
    };
    let sim = sim_config_for(&config.plan);
    let result = search(&config, &default_arena(), &sim);
    let old = search_file(&config, &result);
    for (key, value) in old.as_object().unwrap() {
        assert_eq!(&file[key], value, "existing field {key} changed");
    }
}

// ---- point 4: the plan's tables reach the report ----

#[test]
fn a_report_aggregated_with_the_plans_tables_shows_the_patched_reaction_and_apm_columns() {
    let (arena, sim) = (practice_arena(), fast_config());
    let games: Vec<GameSummary> = play(&tiny_plan(1), &arena, &sim)
        .into_iter()
        .map(|r| r.summary)
        .collect();
    let patched = apply_tune(
        &compiled(),
        &json!({"ablation": true, "tiers": {
            "easy": {"apm": 17, "burst": 9, "reaction": {"mu": 777, "tau": 33}},
            "normal": {"apm": 21, "burst": 8, "reaction": {"mu": 555, "tau": 22}},
            "hard": {"apm": 40, "burst": 7, "reaction": {"mu": 444, "tau": 11}}
        }}),
    )
    .expect("a valid patch");
    let report = aggregate_with(&games, &patched);
    assert_eq!(report.tiers.len(), 3);
    for tier in &report.tiers {
        let want = &patched.tiers[match tier.tier {
            TierId::Easy => 0,
            TierId::Normal => 1,
            TierId::Hard => 2,
        }];
        assert_eq!(
            tier.pooled.table,
            want.reaction.mu + want.reaction.tau,
            "{:?} reaction column",
            tier.tier
        );
        assert_eq!(
            tier.apm_limit,
            want.apm + want.burst,
            "{:?} APM column",
            tier.tier
        );
        for row in &tier.reactions {
            let base = want.reaction.mu + want.reaction.tau;
            assert!(
                [base, base * 1.5, want.daze.mu + want.daze.tau].contains(&row.table),
                "{:?} {} table mean {} is not from the patched table",
                tier.tier,
                row.kind,
                row.table
            );
        }
    }
    // The compiled tables through `aggregate_with` are `aggregate`, so nothing existing moves.
    assert_eq!(
        format!("{:?}", aggregate_with(&games, &compiled())),
        format!("{:?}", aggregate(&games))
    );
}

const BEST_TABLE_DIGEST: &str = "a46a78606f72e62a";
const SEARCH_FILE_DIGEST: &str = "4f6a9796e0c4f140";
