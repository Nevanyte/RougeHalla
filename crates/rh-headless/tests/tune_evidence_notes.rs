//! P-BOT-TUNER-2 follow-up notes: integer counts, a stated basis per block, a verdict line that says what it measures,
//! and a usage footer that is true now.
use rh_headless::tournament::{default_sim_config, TournamentPlan};
use rh_headless::tournament_learning::SeatPolicy;
use rh_headless::tune::{evidence, search, search_file_with_evidence, SearchConfig};
use rh_policy::bots::TierId;
use rh_sim::arenas::practice_arena;
use rh_sim::{ArenaMode, ArenaRules, SimConfig};
use serde_json::Value;

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

fn file(held_out: Option<u32>) -> Value {
    let plan = TournamentPlan::with_tiers(
        1,
        7,
        vec![TierId::Easy, TierId::Normal, TierId::Hard],
        60_000.,
    );
    let config = SearchConfig {
        seed: 5,
        generations: 1,
        population: 1,
        changes: 3,
        step: 0.25,
        plan,
        policy: SeatPolicy::Human,
        commit: "0123abcd".into(),
    };
    let (arena, sim) = (practice_arena(), fast_config());
    let result = search(&config, &arena, &sim);
    let ev = evidence(&config, &result, &arena, &sim, held_out).expect("a valid seed");
    search_file_with_evidence(&config, &result, &ev)
}

fn check_integers(tiers: &Value, what: &str) {
    for tier in ["easy", "normal", "hard"] {
        for side in ["baseline", "best"] {
            for key in ["wins", "games"] {
                let v = &tiers[tier][side][key];
                assert!(
                    v.is_u64(),
                    "{what}.{tier}.{side}.{key} must be a JSON integer: {v}"
                );
            }
        }
    }
}

#[test]
fn wins_and_games_are_integers_and_each_block_states_its_basis() {
    let f = file(Some(11));
    let ev = &f["evidence"];
    check_integers(&ev["search"]["tiers"], "search");
    check_integers(&ev["heldOut"]["tiers"], "heldOut");
    assert_eq!(
        ev["search"]["basis"],
        "in sample: the search's own games; optimistic"
    );
    assert_eq!(
        ev["heldOut"]["basis"],
        "held out: fresh game seeds, same arena and lineup"
    );
    assert!(file(None)["evidence"]["heldOut"].is_null());
}

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

#[test]
fn each_verdict_line_says_it_measures_tier_win_share() {
    let out = std::path::PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("tune_notes_run.json");
    for extra in [&[][..], &["--held-out-tournament-seed", "11"][..]] {
        let run = tune_bin(&out, extra);
        assert!(run.status.success());
        let stdout = String::from_utf8_lossy(&run.stdout);
        for tier in ["easy", "normal", "hard"] {
            let line = stdout
                .lines()
                .find(|l| l.starts_with(&format!("{tier}: ")))
                .unwrap_or_else(|| panic!("no {tier} line: {stdout}"));
            assert!(
                line.ends_with("; tier win share, not the band objective)")
                    || line.contains("; tier win share, not the band objective"),
                "{line:?}"
            );
        }
    }
}

#[test]
fn the_usage_footer_no_longer_calls_brain_seats_passive() {
    let run = std::process::Command::new(env!("CARGO_BIN_EXE_tune"))
        .arg("--help")
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&run.stdout);
    assert!(!text.contains("passive"), "{text}");
    assert!(text.contains("P-BOT-BRAIN-CHOICES-1"), "{text}");
}
