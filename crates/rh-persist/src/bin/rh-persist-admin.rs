//! `rh-persist-admin migrate|import-legacy|reconcile|export-legacy`. Every subcommand takes the database
//! explicitly through `--url` (or `DATABASE_URL`); nothing defaults to a live store.

use std::process::ExitCode;

use rh_persist::admin::{export_legacy, import_legacy, reconcile};
use rh_persist::Store;

const USAGE: &str = "usage:
  rh-persist-admin migrate --url <postgres-url>
  rh-persist-admin import-legacy --file <profiles.json> [--dry-run] --url <postgres-url>
  rh-persist-admin reconcile --url <postgres-url>
  rh-persist-admin export-legacy --out <file> --url <postgres-url>
(--url defaults to $DATABASE_URL)";

struct Args {
    cmd: String,
    url: Option<String>,
    file: Option<String>,
    out: Option<String>,
    dry_run: bool,
}

fn parse(mut it: impl Iterator<Item = String>) -> Result<Args, String> {
    let cmd = it.next().ok_or("missing subcommand")?;
    let mut a = Args {
        cmd,
        url: std::env::var("DATABASE_URL").ok(),
        file: None,
        out: None,
        dry_run: false,
    };
    while let Some(flag) = it.next() {
        match flag.as_str() {
            "--url" => a.url = Some(it.next().ok_or("--url needs a value")?),
            "--file" => a.file = Some(it.next().ok_or("--file needs a value")?),
            "--out" => a.out = Some(it.next().ok_or("--out needs a value")?),
            "--dry-run" => a.dry_run = true,
            other => return Err(format!("unknown argument {other}")),
        }
    }
    Ok(a)
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = match parse(std::env::args().skip(1)) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("error: {e}\n{USAGE}");
            return ExitCode::from(64);
        }
    };
    match run(args).await {
        Ok(code) => code,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

async fn run(a: Args) -> Result<ExitCode, Box<dyn std::error::Error>> {
    let url = a
        .url
        .clone()
        .ok_or("no database: pass --url or set DATABASE_URL")?;
    let store = Store::connect(&url).await?;
    match a.cmd.as_str() {
        "migrate" => {
            store.migrate().await?;
            println!(
                "schema version {}",
                store.schema_version().await?.unwrap_or(0)
            );
            Ok(ExitCode::SUCCESS)
        }
        "import-legacy" => {
            let file = a.file.ok_or("--file is required")?;
            let text = std::fs::read_to_string(&file)?;
            store.migrate().await?;
            let r = import_legacy(&store, &text, a.dry_run).await?;
            println!(
                "{} legacy file v{}: {} profiles parsed, {} dropped, {} inserted ({} GV), {} identical, {} conflicts",
                if r.dry_run { "DRY RUN (rolled back)" } else { "imported" },
                r.file_version,
                r.parsed,
                r.dropped.len(),
                r.inserted,
                r.inserted_gv,
                r.identical,
                r.conflicts.len()
            );
            for (n, why) in &r.dropped {
                println!("  dropped  {n:?}: {why}");
            }
            for (n, why) in &r.conflicts {
                println!("  conflict {n:?}: {why}");
            }
            Ok(if r.conflicts.is_empty() {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(2)
            })
        }
        "reconcile" => {
            let r = reconcile(&store).await?;
            println!(
                "profiles {}  total_gv {}  ledger_rows {}  total_ledger {}  match_results {}  live_leases {}",
                r.profiles, r.total_gv, r.ledger_rows, r.total_ledger, r.match_results, r.live_leases
            );
            if r.month_lifetime_gaps > 0 {
                println!(
                    "note: {} profiles have gv_by_month totals different from gv_lifetime (informational)",
                    r.month_lifetime_gaps
                );
            }
            for (c, gv, sum) in &r.mismatches {
                println!("MISMATCH {c}: gv {gv} != ledger {sum}");
            }
            if r.ok() {
                println!("OK");
                Ok(ExitCode::SUCCESS)
            } else {
                println!("FAILED: {} profiles do not reconcile", r.mismatches.len());
                Ok(ExitCode::FAILURE)
            }
        }
        "export-legacy" => {
            let out = a.out.ok_or("--out is required")?;
            let v = export_legacy(&store).await?;
            std::fs::write(&out, serde_json::to_vec_pretty(&v)?)?;
            println!("wrote {out}. Tokens are unrecoverable hashes: keep the ORIGINAL legacy file for any rollback.");
            Ok(ExitCode::SUCCESS)
        }
        other => Err(format!("unknown subcommand {other}\n{USAGE}").into()),
    }
}
