//! P-BOTS-6 runner remainder regressions: the simulated per-seat command delay line (latencyMs/jitterMs), deterministic
//! parallel play, the carried plan-derived timer/telemetry semantics, and the shared telemetry write path. These drive
//! the built binary as a user does (and the same library entry points it uses); wall-clock meta is the only field nulled
//! when comparing runs.
use rh_headless::tournament::{
    play, play_parallel, run_game, sim_config_for, split, GameResult, TournamentPlan,
};
use rh_headless::tournament_cli::{parse_args, plan_of, write_telemetry};
use serde_json::Value;
use std::io::{self, Write};
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

static NEXT: AtomicU32 = AtomicU32::new(0);

fn run_cli(extra: &[&str]) -> Value {
    let path: PathBuf = std::env::temp_dir().join(format!(
        "rh-runner-remainder-{}-{}.json",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let output = Command::new(env!("CARGO_BIN_EXE_tournament"))
        .args([
            "--lineup",
            "E,E,N,N,H,H",
            "--seed",
            "3",
            "--max-minutes",
            "1",
            "--quiet",
            "--json",
        ])
        .arg(&path)
        .args(extra)
        .output()
        .expect("the tournament binary runs");
    assert!(
        output.status.success(),
        "the tournament binary exited {:?}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    let text = std::fs::read_to_string(&path).expect("the --json payload is written");
    let _ = std::fs::remove_file(&path);
    serde_json::from_str(&text).expect("the --json payload parses")
}

fn plan_of_args(extra: &[&str]) -> TournamentPlan {
    let mut argv: Vec<String> = [
        "--lineup",
        "E,E,N,N,H,H",
        "--seed",
        "3",
        "--max-minutes",
        "1",
        "--quiet",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    argv.extend(extra.iter().map(|s| s.to_string()));
    plan_of(&parse_args(&argv, 4).expect("the plan arguments parse"))
}

/// The payload without its wall-clock meta (the runner's only legitimate nondeterminism).
fn without_wall(payload: &Value) -> Value {
    let mut copy = payload.clone();
    if let Some(meta) = copy.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("wallMs".into(), Value::Null);
        meta.insert("gameMs".into(), Value::Null);
    }
    copy
}

fn summaries(results: &[GameResult]) -> Vec<u64> {
    results.iter().map(|r| u64::from(r.index)).collect()
}

#[test]
fn simulated_latency_and_jitter_are_deterministic_and_off_by_default() {
    let baseline = plan_of_args(&["--games", "1"]);
    let config = sim_config_for(&baseline);
    let baseline_game = run_game(0, &baseline, &rh_sim::arenas::practice_arena(), &config);
    // An explicit zero line is the same no-line run: the wrapper is only installed for a positive latency or jitter.
    let zero = plan_of_args(&["--games", "1", "--latency", "0"]);
    let zero_game = run_game(
        0,
        &zero,
        &rh_sim::arenas::practice_arena(),
        &sim_config_for(&zero),
    );
    assert_eq!(
        baseline_game, zero_game,
        "zero-latency behaviour is byte-identical to the unwrapped runner"
    );
    // A latency delays every command: the game evolves differently, and replays exactly.
    let latency = plan_of_args(&["--games", "1", "--latency", "250"]);
    let arena = rh_sim::arenas::practice_arena();
    let delayed = run_game(0, &latency, &arena, &sim_config_for(&latency));
    assert_ne!(
        delayed, baseline_game,
        "a 250 ms command delay changes the game"
    );
    assert_eq!(
        delayed,
        run_game(0, &latency, &arena, &sim_config_for(&latency)),
        "the delay line is deterministic"
    );
    // Jitter moves the arrivals again, deterministically.
    let jitter = plan_of_args(&["--games", "1", "--latency", "250", "--jitter", "100"]);
    let jittered = run_game(0, &jitter, &arena, &sim_config_for(&jitter));
    assert_ne!(jittered, delayed, "jitter changes the arrivals");
    assert_eq!(
        jittered,
        run_game(0, &jitter, &arena, &sim_config_for(&jitter)),
        "the jitter stream is deterministic per seat seed"
    );
}

#[test]
fn parallel_play_is_the_serial_run_in_index_order() {
    let plan = plan_of_args(&["--games", "4", "--workers", "4"]);
    let arena = rh_sim::arenas::practice_arena();
    let config = sim_config_for(&plan);
    let serial = play(&plan, &arena, &config);
    let parallel = play_parallel(&plan, &arena, &config, 4);
    assert_eq!(
        parallel, serial,
        "parallel play is the serial run, game for game"
    );
    assert_eq!(
        summaries(&parallel),
        vec![0, 1, 2, 3],
        "results are in index order"
    );
    // The split is the source's deterministic batch split and a worker count of one is the serial path.
    assert_eq!(split(4, 4), vec![vec![0], vec![1], vec![2], vec![3]]);
    assert_eq!(play_parallel(&plan, &arena, &config, 1), serial);
    // Running it again reproduces the same aggregation (no completion-order leak).
    assert_eq!(play_parallel(&plan, &arena, &config, 4), serial);
}

#[test]
fn the_cli_parallel_run_matches_the_serial_run_modulo_wall_meta() {
    let serial_args = ["--games", "3", "--workers", "1"];
    let parallel_args = ["--games", "3", "--workers", "3"];
    let serial = run_cli(&serial_args);
    let parallel = run_cli(&parallel_args);
    let parallel_again = run_cli(&parallel_args);
    // Only the wall-clock meta and the requested worker count differ; the games, the plan and the report are identical.
    assert_eq!(
        without_wall(&serial)["games"],
        without_wall(&parallel)["games"],
        "the parallel run's games are the serial run's games"
    );
    assert_eq!(
        serial["report"], parallel["report"],
        "the parallel report is the serial report"
    );
    assert_eq!(serial["plan"], parallel["plan"]);
    assert_eq!(serial["meta"]["workers"], 1);
    assert_eq!(parallel["meta"]["workers"], 3);
    assert_eq!(
        without_wall(&parallel),
        without_wall(&parallel_again),
        "the parallel run is deterministic"
    );
    // The whole payload, not just the aggregates: the only differences are the wall clock and the requested worker
    // count itself (the configured experiment, not a result difference).
    let mut a = without_wall(&serial);
    let mut b = without_wall(&parallel);
    for payload in [&mut a, &mut b] {
        if let Some(meta) = payload.get_mut("meta").and_then(Value::as_object_mut) {
            meta.insert("workers".into(), Value::Null);
        }
    }
    assert_eq!(
        a, b,
        "the serial and parallel payloads differ only in wall meta/worker count"
    );
}

#[test]
fn the_cli_applies_simulated_latency_deterministically() {
    let delayed = run_cli(&["--games", "1", "--latency", "250", "--jitter", "100"]);
    assert_eq!(delayed["plan"]["latencyMs"], 250.0);
    assert_eq!(delayed["plan"]["jitterMs"], 100.0);
    assert_eq!(
        without_wall(&delayed),
        without_wall(&run_cli(&[
            "--games",
            "1",
            "--latency",
            "250",
            "--jitter",
            "100"
        ])),
        "the CLI's delayed run is deterministic"
    );
    let undelayed = run_cli(&["--games", "1"]);
    assert!(
        undelayed["plan"].get("latencyMs").is_none(),
        "the default plan carries no delay line"
    );
    assert_ne!(
        without_wall(&delayed)["games"],
        without_wall(&undelayed)["games"],
        "the CLI's latency flag reaches the runner"
    );
}

#[test]
fn the_cli_keeps_the_plan_derived_timer_configuration() {
    let payload = run_cli(&["--games", "1", "--patience", "1", "--sudden", "1"]);
    assert_eq!(payload["plan"]["config"]["patienceSeconds"], 1.0);
    assert_eq!(payload["plan"]["config"]["patienceMinSeconds"], 0.4);
    assert_eq!(payload["plan"]["config"]["suddenDeathSeconds"], 1.0);
    let teleport = payload["games"][0]["teleportMs"]
        .as_f64()
        .unwrap_or_else(|| {
            panic!(
                "--patience 1 must reach the sim timer: {}",
                payload["games"][0]
            )
        });
    // The source scales the configured 1 s between 40% (three alive) and 100% (eight alive): the six-seat game lands
    // inside that band, so the configured timer (not the default 120 s) drove the phase transition.
    assert!(
        (400.0..=2000.0).contains(&teleport),
        "the patience timer fired at {teleport} ms, not the configured ~1 s"
    );
}

/// A portable failing sink for the shared telemetry write path.
struct FailingWriter {
    remaining: usize,
    written: usize,
}
impl Write for FailingWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if buf.len() > self.remaining {
            return Err(io::Error::other("telemetry sink is full"));
        }
        self.remaining -= buf.len();
        self.written += buf.len();
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[test]
fn telemetry_write_errors_are_propagated_not_swallowed() {
    let lines = vec![
        r#"{"seed":7,"game":1}"#.to_string(),
        r#"{"seed":7,"game":2}"#.to_string(),
    ];
    let mut broken = FailingWriter {
        remaining: 0,
        written: 0,
    };
    let error = write_telemetry(&mut broken, &lines)
        .expect_err("a failing telemetry sink must surface its error");
    assert_eq!(error.kind(), io::ErrorKind::Other);
    let first = lines[0].len() + 1;
    let mut partial = FailingWriter {
        remaining: first,
        written: 0,
    };
    let error = write_telemetry(&mut partial, &lines)
        .expect_err("a mid-stream telemetry failure must surface");
    assert_eq!(error.kind(), io::ErrorKind::Other);
    assert!(partial.written > 0 && partial.written < lines[0].len() + lines[1].len() + 2);
    // Default output preserved: one NDJSON record per line.
    let mut healthy: Vec<u8> = Vec::new();
    write_telemetry(&mut healthy, &lines).expect("a Vec sink writes");
    assert_eq!(
        String::from_utf8(healthy).expect("utf-8"),
        "{\"seed\":7,\"game\":1}\n{\"seed\":7,\"game\":2}\n"
    );
}

#[test]
fn the_cli_fails_when_the_telemetry_destination_cannot_be_opened() {
    let blocker: PathBuf = std::env::temp_dir().join(format!(
        "rh-runner-telemetry-blocker-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::write(&blocker, b"a file, not a directory").expect("the blocker file writes");
    let output = Command::new(env!("CARGO_BIN_EXE_tournament"))
        .args([
            "--games",
            "1",
            "--lineup",
            "E,E",
            "--seed",
            "3",
            "--max-minutes",
            "1",
            "--quiet",
            "--telemetry",
        ])
        .arg(&blocker)
        .output()
        .expect("the tournament binary runs");
    let _ = std::fs::remove_file(&blocker);
    assert!(
        !output.status.success(),
        "an unopenable telemetry destination fails the run: {:?}",
        output.status
    );
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("cannot write telemetry"),
        "the failure is reported: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn learning_defaults_off_and_explicit_on_is_refused_before_play() {
    let args = parse_args(&[], 4).unwrap();
    assert!(!args.learn);
    assert!(!plan_of(&args).learn);
    let payload = run_cli(&["--games", "1"]);
    assert_eq!(payload["meta"]["learn"], false);
    assert_eq!(payload["plan"]["learn"], false);
    let enabled = Command::new(env!("CARGO_BIN_EXE_tournament"))
        .args(["--learn", "on"])
        .output()
        .unwrap();
    assert_eq!(enabled.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&enabled.stderr).contains("no learning store is activated"));
    assert!(!String::from_utf8_lossy(&enabled.stdout).contains("learning on"));
}

#[test]
fn measured_worker_games_keep_values_and_mean_individual_durations() {
    use rh_headless::tournament::{mean_game_ms, play_measured, MeasuredGame};
    let mut plan = plan_of_args(&["--games", "2", "--workers", "2"]);
    plan.max_sim_ms = 1000.;
    let config = sim_config_for(&plan);
    let arena = rh_sim::arenas::practice_arena();
    let measured = play_measured(&plan, &arena, &config);
    let pure = play_parallel(&plan, &arena, &config, 2);
    assert_eq!(
        measured.iter().map(|m| &m.result).collect::<Vec<_>>(),
        pure.iter().collect::<Vec<_>>()
    );
    assert!(measured
        .iter()
        .all(|m| m.wall_ms.is_finite() && m.wall_ms >= 0.));
    assert_eq!(mean_game_ms(&[]), None);
    // Two overlapping worker games took 10 and 30 ms. With 30 ms total wall the throughput
    // quotient is 15; the source's mean worker game duration is 20, regardless of that overlap.
    let declared = vec![
        MeasuredGame {
            result: pure[0].clone(),
            wall_ms: 10.,
        },
        MeasuredGame {
            result: pure[1].clone(),
            wall_ms: 30.,
        },
    ];
    assert_eq!(mean_game_ms(&declared), Some(20.));
}

#[test]
fn advanced_profiles_return_unavailable_damage_and_first_hit_telemetry() {
    use rh_headless::tournament::aggregate;
    use rh_headless::tournament_cli::json_payload;
    let mut plan = plan_of_args(&["--games", "1"]);
    plan.max_sim_ms = 1000.;
    for config in [
        rh_sim::SimConfig {
            faction_mode: rh_sim::FactionMode::EngagementHolyPlagueFire,
            lobby_seconds: 0.,
            ..sim_config_for(&plan)
        },
        rh_sim::SimConfig {
            abilities: rh_sim::abilities::Mode::Full,
            lobby_seconds: 0.,
            ..sim_config_for(&plan)
        },
    ] {
        let game = run_game(0, &plan, &rh_sim::arenas::practice_arena(), &config);
        assert!(game.first_hits.is_none());
        assert!(game
            .bots
            .iter()
            .all(|b| b.damage.is_none() && b.mob_damage.is_none()));
        let report = aggregate(std::slice::from_ref(&game));
        assert!(report.tiers.iter().all(|t| t.damage_per_bot.is_nan()
            && t.mob_damage_per_bot.is_nan()
            && t.never_fought.is_nan()));
        let json = json_payload(&plan, &report, &[game], None, None);
        assert!(json["games"][0]["firstHits"].is_null());
        assert!(json["games"][0]["bots"][0]["damage"].is_null());
        assert!(json["report"]["tiers"][0]["neverFought"].is_null());
    }
}
