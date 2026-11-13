//! The offline Brain table search (P-BOT-TUNER-1; R-ML narrow exception, clause 2): a seeded hill-climb over the
//! existing TIERS / PERSONAS numbers, scored by headless tournament placement, writing the best table found as JSON for
//! review. It never changes the compiled tables or the checked-in table: adopting a searched table is a separate,
//! reviewed change.
use rh_headless::tournament::{parse_lineup, sim_config_for, TournamentPlan};
use rh_headless::tournament_cli::default_arena;
use rh_headless::tournament_learning::SeatPolicy;
use rh_headless::tune::{search, search_file, table_file, SearchConfig};
use rh_policy::bots::types::BrainTables;

const USAGE: &str = "usage: cargo run --release -p rh-headless --bin tune -- [options]
  --seed N          the search's seed (default 1): its proposals come from this stream only
  --generations N   generations (default 10)
  --population N    proposals per generation (default 4)
  --changes N       numbers moved per proposal (default 4)
  --step X          largest move, as a share of a number's bound width (default 0.25)
  --games N         tournament games per scored table (default 24)
  --lineup L        E(asy) N(ormal) H(ard) per seat (default E,E,N,N,H,H)
  --tournament-seed N  the scoring tournament's seed (default 1; every table plays the same games)
  --held-out-tournament-seed N  re-score the best table against the shipped tables on this seed (never a search seed)
  --policy P        brain (default) or human
  --workers N       worker threads per tournament (default 1; results fold in plan order)
  --max-minutes M   --patience S   --sudden S   the scoring games' timers (tournament defaults)
  --commit SHA      the commit written into the file (default: git rev-parse --short HEAD)
  --out FILE        where the search writes (default brain-search.json)
  --write-compiled FILE   write the compiled tables as a table file and exit (the checked-in
                    crates/rh-policy/data/brain_tuning.json is this file)
  --help

Brain seats are passive until P-BOT-BRAIN-CONTINUITY-1 lands: until then a search's scores mean nothing.";

fn value(args: &mut std::slice::Iter<'_, String>, flag: &str) -> Result<String, String> {
    args.next()
        .cloned()
        .ok_or_else(|| format!("{flag} needs a value"))
}

fn number<T: std::str::FromStr>(raw: &str, flag: &str) -> Result<T, String> {
    raw.parse()
        .map_err(|_| format!("{flag} needs a number, got \"{raw}\""))
}

fn commit() -> String {
    std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())
        .unwrap_or_else(|| "unknown".into())
}

fn run(argv: &[String]) -> Result<(), String> {
    let mut config = SearchConfig {
        seed: 1,
        generations: 10,
        population: 4,
        changes: 4,
        step: 0.25,
        plan: TournamentPlan::with_tiers(
            24,
            1,
            parse_lineup("E,E,N,N,H,H")?,
            rh_headless::tournament::MAX_GAME_MS,
        ),
        policy: SeatPolicy::Brain,
        commit: String::new(),
    };
    let mut out = "brain-search.json".to_owned();
    let mut commit_given = None;
    let mut args = argv.iter();
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--" => {}
            "--help" | "-h" => {
                println!("{USAGE}");
                return Ok(());
            }
            "--write-compiled" => {
                let path = value(&mut args, flag)?;
                let text = serde_json::to_string_pretty(&table_file(&BrainTables::COMPILED))
                    .map_err(|e| e.to_string())?
                    + "\n";
                std::fs::write(&path, text).map_err(|e| format!("cannot write {path}: {e}"))?;
                println!("wrote the compiled tables to {path}");
                return Ok(());
            }
            "--seed" => config.seed = number(&value(&mut args, flag)?, flag)?,
            "--generations" => config.generations = number(&value(&mut args, flag)?, flag)?,
            "--population" => config.population = number(&value(&mut args, flag)?, flag)?,
            "--changes" => config.changes = number(&value(&mut args, flag)?, flag)?,
            "--step" => config.step = number(&value(&mut args, flag)?, flag)?,
            "--games" => config.plan.games = number(&value(&mut args, flag)?, flag)?,
            "--lineup" => config.plan.tiers = parse_lineup(&value(&mut args, flag)?)?,
            "--tournament-seed" => config.plan.seed = number(&value(&mut args, flag)?, flag)?,
            "--held-out-tournament-seed" => {
                // P-BOT-TUNER-2 stub: parsed and ignored.
                let _held_out: u32 = number(&value(&mut args, flag)?, flag)?;
            }
            "--workers" => {
                config.plan.workers = number::<u32>(&value(&mut args, flag)?, flag)?.max(1)
            }
            "--max-minutes" => {
                config.plan.max_sim_ms = number::<f64>(&value(&mut args, flag)?, flag)? * 60_000.
            }
            "--patience" => {
                config.plan.patience_seconds = Some(number(&value(&mut args, flag)?, flag)?)
            }
            "--sudden" => {
                config.plan.sudden_death_seconds = Some(number(&value(&mut args, flag)?, flag)?)
            }
            "--policy" => {
                let v = value(&mut args, flag)?;
                config.policy = SeatPolicy::parse(&v)
                    .ok_or_else(|| format!("--policy takes human or brain, got \"{v}\""))?;
            }
            "--commit" => commit_given = Some(value(&mut args, flag)?),
            "--out" => out = value(&mut args, flag)?,
            other => return Err(format!("unknown option \"{other}\"")),
        }
    }
    if !(config.step > 0. && config.step <= 1.) {
        return Err("--step takes a share in (0, 1]".into());
    }
    if config.population == 0 || config.changes == 0 || config.plan.games == 0 {
        return Err("--population, --changes and --games need at least 1".into());
    }
    config.commit = commit_given.unwrap_or_else(commit);
    let arena = default_arena();
    let sim = sim_config_for(&config.plan);
    let result = search(&config, &arena, &sim);
    let text = serde_json::to_string_pretty(&search_file(&config, &result))
        .map_err(|e| e.to_string())?
        + "\n";
    std::fs::write(&out, text).map_err(|e| format!("cannot write {out}: {e}"))?;
    println!(
        "baseline {:.4}  best {:.4}  ({} proposals scored)\nwrote {out}",
        result.baseline_score,
        result.best_score,
        result.candidates.len()
    );
    Ok(())
}

fn main() -> std::process::ExitCode {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    match run(&argv) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}\n\n{USAGE}");
            std::process::ExitCode::from(2)
        }
    }
}
