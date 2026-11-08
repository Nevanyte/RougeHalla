//! Actual CLI regression for the tournament timer wiring (lead packet TOURNAMENT_TIMER_REPAIR): the binary must derive the
//! simulation configuration from its plan at the run call site, so --patience and --sudden change the real sim timers and
//! phase transitions rather than only the exported plan. Each test drives the built binary exactly as a user does and
//! reads the --json payload; the deterministic default control replays the same plan.
use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

/// An eight-seat lobby (one seat per spawn) so the run has time to reach the patience phase transition before anyone wins.
const LINEUP: &str = "E,E,N,N,H,H,E,N";
const SEED: &str = "3";
const GAMES: &str = "1";
const MAX_MINUTES: &str = "2";
static NEXT: AtomicU32 = AtomicU32::new(0);

/// Run the binary with the given extra flags, request the JSON export and return the parsed payload.
fn run(extra: &[&str]) -> Value {
    let path: PathBuf = std::env::temp_dir().join(format!(
        "rh-tournament-timers-{}-{}.json",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let output = Command::new(env!("CARGO_BIN_EXE_tournament"))
        .args([
            "--games",
            GAMES,
            "--lineup",
            LINEUP,
            "--seed",
            SEED,
            "--max-minutes",
            MAX_MINUTES,
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

fn game(payload: &Value) -> &Value {
    &payload["games"][0]
}

/// The payload without its wall-clock meta (the one legitimate nondeterminism of the CLI surface).
fn without_wall(payload: &Value) -> Value {
    let mut copy = payload.clone();
    if let Some(meta) = copy.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("wallMs".into(), Value::Null);
        meta.insert("gameMs".into(), Value::Null);
    }
    copy
}

fn teleport(payload: &Value) -> Option<f64> {
    game(payload)["teleportMs"].as_f64()
}

#[test]
fn the_cli_plan_timers_reach_the_simulation_and_the_default_control_is_deterministic() {
    let default = run(&[]);
    let overridden = run(&["--patience", "1", "--sudden", "1"]);
    let slow_sudden = run(&["--patience", "1", "--sudden", "20"]);

    // 1. The exported plan describes the configuration the run must use.
    assert!(
        default["plan"].get("config").is_none(),
        "a default plan carries no config override"
    );
    assert_eq!(overridden["plan"]["config"]["patienceSeconds"], 1.0);
    assert_eq!(overridden["plan"]["config"]["patienceMinSeconds"], 0.4);
    assert_eq!(overridden["plan"]["config"]["suddenDeathSeconds"], 1.0);
    assert_eq!(slow_sudden["plan"]["config"]["suddenDeathSeconds"], 20.0);

    // 2. --patience reaches the real sim timer: the coliseum teleport (the patience phase transition) fires at about one
    //    second instead of never inside the default run's two-minute cap.
    assert_eq!(
        teleport(&default),
        None,
        "the default 120 s / 48 s patience cannot reach the teleport inside the cap: {}",
        game(&default)
    );
    let fast = teleport(&overridden).unwrap_or_else(|| {
        panic!(
            "--patience 1 must trigger the real teleport phase: {}",
            game(&overridden)
        )
    });
    assert!(
        (900.0..=2000.0).contains(&fast),
        "the patience timer fired at {fast} ms, not the configured ~1 s: {}",
        game(&overridden)
    );
    assert_eq!(
        game(&overridden)["ended"],
        true,
        "the patienced run finishes instead of capping: {}",
        game(&overridden)
    );

    // 3. The default control is deterministic and clearly not the overridden behavior.
    let default_again = run(&[]);
    assert_eq!(
        without_wall(&default),
        without_wall(&default_again),
        "the same default plan replays to the same payload"
    );
    assert_ne!(
        without_wall(&default)["games"],
        without_wall(&overridden)["games"],
        "the override changes the game the binary plays"
    );

    // 4. --sudden reaches the post-teleport phase transition: the patience teleport is the same, but the sudden-death
    //    settings change when the arena kills and how the game resolves.
    assert_eq!(
        teleport(&slow_sudden),
        Some(fast),
        "--sudden must not move the patience teleport"
    );
    let fast_duration = game(&overridden)["durationMs"]
        .as_f64()
        .expect("a duration");
    let slow_duration = game(&slow_sudden)["durationMs"]
        .as_f64()
        .expect("a duration");
    assert!(
        slow_duration > fast_duration,
        "--sudden 20 keeps the arena kills later than --sudden 1 ({slow_duration} vs {fast_duration} ms)"
    );
    assert_ne!(
        game(&overridden)["bots"],
        game(&slow_sudden)["bots"],
        "--sudden changes the run's outcomes"
    );
    assert_ne!(
        game(&overridden)["winner"],
        game(&slow_sudden)["winner"],
        "--sudden changes the phase transition's winner"
    );
}
