//! The tournament CLI over the headless environment (source packages/server/src/bots/tournament/runTournament.ts): the
//! full source option surface, the deterministic plan, the printed report and the --json export. The wall clock is read
//! only here, for the progress line, the throughput meta and the per-game wall; the tournament itself is a pure function
//! of its plan.
use rh_headless::tournament::{
    aggregate, format_report, run_game, sim_config_for, GameSummary, TournamentMeta,
    TournamentReport,
};
use rh_headless::tournament_cli::{
    default_arena, json_payload, parse_args, plan_of, write_telemetry, USAGE,
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
    let cores = std::thread::available_parallelism().map_or(1, |n| n.get());
    let args = match parse_args(&argv, cores) {
        Ok(args) => args,
        Err(message) => {
            eprintln!("{message}\n\n{USAGE}");
            return std::process::ExitCode::from(2);
        }
    };
    if args.help {
        println!("{USAGE}");
        return std::process::ExitCode::SUCCESS;
    }
    if args.tune.is_some() {
        eprintln!(
            "--tune: the ported runner does not apply TIERS/PERSONAS table patches yet (they are compile-time constants; \
             P-BOTS-6 remainder). Refusing a tuning diagnostic that would silently ignore its patch."
        );
        return std::process::ExitCode::from(2);
    }
    let plan = plan_of(&args);
    let arena = default_arena();
    // The plan stands for the experiment: the run's configuration is derived from it at this call site (the source's
    // planOf config), so --patience/--sudden reach the real sim timers instead of being carried only in the payload.
    let config = sim_config_for(&plan);
    let started = Instant::now();
    let mut games: Vec<GameSummary> = Vec::with_capacity(plan.games as usize);
    let mut game_wall = 0.;
    let mut telemetry: Vec<String> = Vec::new();
    for index in 0..plan.games {
        let at = Instant::now();
        let summary = run_game(index, &plan, &arena, &config);
        game_wall += at.elapsed().as_secs_f64() * 1000.;
        if args.telemetry_dir.is_some() {
            // The ported telemetry surface: the reduced summary per game (the source docs/TELEMETRY.md record is the
            // P-BOTS-6 remainder item 3).
            telemetry.push(
                json_payload(
                    &plan,
                    &aggregate(std::slice::from_ref(&summary)),
                    std::slice::from_ref(&summary),
                    None,
                    None,
                )["games"][0]
                    .to_string(),
            );
        }
        games.push(summary);
    }
    let wall_ms = started.elapsed().as_secs_f64() * 1000.;
    let game_ms = if games.is_empty() {
        f64::NAN
    } else {
        game_wall / games.len() as f64
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
    let tournament = TournamentReport {
        meta: TournamentMeta {
            games: plan.games,
            seed: plan.seed,
            lineup: plan.tiers.clone(),
            persona: plan.persona.as_str().to_owned(),
            faction: plan.faction.as_str().to_owned(),
            max_sim_ms: plan.max_sim_ms,
        },
        report: report.clone(),
        games: games.clone(),
    };
    print!("{}", format_report(&tournament));
    if args.json.is_some() {
        let payload = json_payload(&plan, &report, &games, Some(wall_ms), Some(game_ms));
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
