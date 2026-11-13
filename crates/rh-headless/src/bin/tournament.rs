//! The tournament CLI over the headless environment (source packages/server/src/bots/tournament/runTournament.ts): the
//! full source option surface, the deterministic plan, the printed report and the --json export. The wall clock is read
//! only in the diagnostic measurement wrapper and here for total throughput. Clocks never enter
//! policy inputs or authoritative simulation.
use rh_headless::tournament::{
    aggregate, format_report_with, mean_game_ms, play_measured, sim_config_for, GameSummary,
    ReportMeta,
};
use rh_headless::tournament_cli::{
    default_arena, json_payload, lineup_text, parse_args, plan_of, write_telemetry, USAGE,
};
use rh_headless::tournament_learning::{
    check_learning, learning_file, play_learning, play_policy, split_learning_args, LearnStore,
    SeatPolicy, DEFAULT_LEARN_OUT, LEARNING_USAGE,
};
use std::time::Instant;

/// The source telemetry file name: runs-<UTC day>.ndjson.
fn day_name() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    // A civil date from days since 1970-01-01 (Howard Hinnant's algorithm), UTC.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

fn main() -> std::process::ExitCode {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    // The learning flags are not part of the source CLI surface: taken out before the source parser sees argv.
    let (argv, learning) = match split_learning_args(&argv) {
        Ok(split) => split,
        Err(message) => {
            eprintln!("{message}\n\n{USAGE}\n{LEARNING_USAGE}");
            return std::process::ExitCode::from(2);
        }
    };
    let cores = std::thread::available_parallelism().map_or(1, |n| n.get());
    let args = match parse_args(&argv, cores) {
        Ok(args) => args,
        Err(message) => {
            eprintln!("{message}\n\n{USAGE}\n{LEARNING_USAGE}");
            return std::process::ExitCode::from(2);
        }
    };
    if args.help {
        println!("{USAGE}\n{LEARNING_USAGE}");
        return std::process::ExitCode::SUCCESS;
    }
    if let Err(message) = check_learning(learning.policy, args.learn) {
        eprintln!("{message}");
        return std::process::ExitCode::from(2);
    }
    // The legacy tune.ts diagnostic: the patch is checked before any game (play installs it around every game).
    let plan_check = plan_of(&args);
    if let Err(message) = rh_headless::tune::plan_tables(&plan_check) {
        eprintln!("{message}");
        return std::process::ExitCode::from(2);
    }
    let plan = plan_of(&args);
    let arena = default_arena();
    // The plan stands for the experiment: the run's configuration is derived from it at this call site (the source's
    // planOf config), so --patience/--sudden reach the real sim timers instead of being carried only in the payload.
    let config = sim_config_for(&plan);
    let started = Instant::now();
    let mut store = LearnStore::new();
    let (games, game_ms): (Vec<GameSummary>, Option<f64>) = if plan.learn {
        // One store through the whole series, games in plan order (the worker count does not apply).
        let games = play_learning(&plan, &arena, &config, learning.policy, &mut store);
        (games.into_iter().map(|g| g.summary).collect(), None)
    } else if learning.policy != SeatPolicy::Human {
        (play_policy(&plan, &arena, &config, learning.policy), None)
    } else {
        let results = play_measured(&plan, &arena, &config);
        let game_ms = mean_game_ms(&results);
        (
            results
                .iter()
                .map(|result| result.result.summary.clone())
                .collect(),
            game_ms,
        )
    };
    let wall_ms = started.elapsed().as_secs_f64() * 1000.;
    // The ported telemetry surface: the per-game summary record, in plan order (the full docs/TELEMETRY.md record body
    // is the P-BOTS-6 remainder item 3).
    let telemetry: Vec<String> = if args.telemetry_dir.is_some() {
        games
            .iter()
            .map(|summary| {
                json_payload(
                    &plan,
                    &aggregate(std::slice::from_ref(summary)),
                    std::slice::from_ref(summary),
                    None,
                    None,
                )["games"][0]
                    .to_string()
            })
            .collect()
    } else {
        Vec::new()
    };
    let report = aggregate(&games);
    if !args.quiet {
        eprintln!(
            "{} games in {:.2?}, {:.1} games/s",
            games.len(),
            started.elapsed(),
            games.len() as f64 / started.elapsed().as_secs_f64().max(1e-9)
        );
    }
    let meta = ReportMeta {
        lineup: lineup_text(&plan.tiers),
        seed: plan.seed,
        learn: plan.learn,
        persona: plan.persona.as_str().to_owned(),
        faction: plan.faction.as_str().to_owned(),
        workers: plan.workers,
        wall_ms: Some(wall_ms),
        game_ms,
    };
    print!("{}", format_report_with(&report, &meta));
    if args.json.is_some() {
        let payload = json_payload(&plan, &report, &games, Some(wall_ms), game_ms);
        if let Some(path) = &args.json {
            if let Err(error) =
                std::fs::write(path, serde_json::to_string(&payload).unwrap_or_default())
            {
                eprintln!("cannot write {}: {error}", path);
                return std::process::ExitCode::from(2);
            }
            println!("\nwrote {path}");
        }
    }
    if plan.learn {
        let path = learning.learn_out.as_deref().unwrap_or(DEFAULT_LEARN_OUT);
        let file = learning_file(&plan, learning.policy, &store);
        let text = serde_json::to_string_pretty(&file).unwrap_or_default() + "\n";
        if let Err(error) = std::fs::write(path, text) {
            eprintln!("cannot write {path}: {error}");
            return std::process::ExitCode::from(2);
        }
        println!(
            "\nwrote the learning store ({} choice keys) to {path}",
            store.stats().entries().len()
        );
    }
    if let Some(dir) = &args.telemetry_dir {
        let path = std::path::Path::new(dir).join(format!("runs-{}.ndjson", day_name()));
        let created = std::fs::create_dir_all(dir).and_then(|_| {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
        });
        match created {
            Ok(mut file) => {
                // The shared write path propagates every record/flush error: a partial telemetry file is a run failure,
                // never a printed success.
                if let Err(error) = write_telemetry(&mut file, &telemetry) {
                    eprintln!("cannot write telemetry in {dir}: {error}");
                    return std::process::ExitCode::from(2);
                }
                if !args.quiet {
                    eprintln!(
                        "wrote {} telemetry records to {}",
                        telemetry.len(),
                        path.display()
                    );
                }
            }
            Err(error) => {
                eprintln!("cannot write telemetry in {dir}: {error}");
                return std::process::ExitCode::from(2);
            }
        }
    }
    std::process::ExitCode::SUCCESS
}
