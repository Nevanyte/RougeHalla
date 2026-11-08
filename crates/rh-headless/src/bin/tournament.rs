//! The tournament CLI over the headless environment (source packages/server/src/bots/tournament/runTournament.ts,
//! reduced): plays a deterministic plan of bot-vs-bot games through the rh-headless policy seats and prints the report.
//! The wall clock is read only here, for the progress line; the tournament itself is a pure function of its plan.
use rh_headless::tournament::{
    default_sim_config, format_report, parse_lineup, run, TournamentPlan, MAX_GAME_MS,
};
use rh_sim::arenas::practice_arena;
use std::time::Instant;

const USAGE: &str = "usage: cargo run -p rh-headless --bin tournament -- [options]
  --games N        games to play (default 400)
  --seed N         the tournament seed (default 1): game seeds, factions and personas all derive from it
  --lineup L       one letter per seat, E(asy) N(ormal) H(ard), comma separated (default E,E,N,N,H,H; 2 to 8 seats)
  --max-minutes M  cut a game off after M simulated minutes (default 12)
  --quiet          no progress on stderr
  --help";

fn number(flag: &str, raw: Option<&String>, min: f64, integer: bool) -> Result<f64, String> {
    let text = raw.ok_or_else(|| format!("{flag} needs a value"))?;
    let value: f64 = text
        .trim()
        .parse()
        .map_err(|_| format!("{flag} needs a number, got \"{text}\""))?;
    let integral = !integer || value.fract() == 0.;
    if !value.is_finite() || value < min || !integral {
        return Err(format!(
            "{flag} needs {} of at least {min}, got \"{text}\"",
            if integer { "an integer" } else { "a number" }
        ));
    }
    Ok(value)
}

fn main() -> std::process::ExitCode {
    let mut games = 400u32;
    let mut seed = 1u32;
    let mut lineup = "E,E,N,N,H,H".to_owned();
    let mut max_minutes = MAX_GAME_MS / 60_000.;
    let mut quiet = false;
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut rest = args.iter();
    while let Some(flag) = rest.next() {
        let mut value = || rest.next();
        let result: Result<(), String> = match flag.as_str() {
            "--" => Ok(()),
            "--games" => number(flag, value(), 1., true).map(|n| {
                games = n as u32;
            }),
            "--seed" => number(flag, value(), 0., true).map(|n| {
                seed = (n as u64 & 0xffff_ffff) as u32;
            }),
            "--lineup" => value()
                .cloned()
                .ok_or_else(|| "--lineup needs a value".to_owned())
                .map(|text| lineup = text),
            "--max-minutes" => number(flag, value(), 0.1, false).map(|n| {
                max_minutes = n;
            }),
            "--quiet" => {
                quiet = true;
                Ok(())
            }
            "--help" | "-h" => {
                println!("{USAGE}");
                return std::process::ExitCode::SUCCESS;
            }
            other => Err(format!("unknown option \"{other}\"\n\n{USAGE}")),
        };
        if let Err(message) = result {
            eprintln!("{message}");
            return std::process::ExitCode::from(2);
        }
    }
    let tiers = match parse_lineup(&lineup) {
        Ok(tiers) => tiers,
        Err(message) => {
            eprintln!("{message}\n\n{USAGE}");
            return std::process::ExitCode::from(2);
        }
    };
    let plan = TournamentPlan::with_tiers(games, seed, tiers, max_minutes * 60_000.);
    let started = Instant::now();
    let tournament = run(&plan, &practice_arena(), &default_sim_config());
    if !quiet {
        eprintln!(
            "{} games in {:.2?}, {:.1} games/s",
            tournament.games.len(),
            started.elapsed(),
            tournament.games.len() as f64 / started.elapsed().as_secs_f64()
        );
    }
    print!("{}", format_report(&tournament));
    std::process::ExitCode::SUCCESS
}
