//! `rh-load run|sweep ...` (see crates/rh-load/README.md for every option).

use rh_load::report;
use rh_load::runner::{self, RunOpts};
use rh_load::scenario::{scenario_from, ArgMap};
use rh_load::server::ServerSpec;
use std::net::SocketAddr;
use std::path::PathBuf;

const USAGE: &str = "usage:
  rh-load run   --server-bin <path/to/rh-server> [scenario options] [--label L] [--out-dir DIR]
  rh-load run   --target host:port --control host:port [--pid N] --dev-auth [scenario options]
  rh-load sweep --server-bin <path> --levels 10,25,50 [scenario options] [--label L] [--out-dir DIR]
common: --emulated --hardware-label TEXT --build-profile release|debug --server-arg ARG (repeatable via quoted list: --server-args \"--map x.json\")
scenario: --matches N --players-per-match P --ramp-per-sec R --duration S --think-ms MS --aggression A --reconnect-fraction F
  --reconnect-every S --reconnect-delay-ms MIN:MAX --churn-clients K --churn-dwell MIN:MAX --slow-fraction F --slow-stall-secs S
  --shutdown-at S --shutdown-mode sigterm|drain --drain-wait S --tls --insecure --no-rejoin --seed N --sample-secs S
  --max-rooms N --min-players N --lobby-seconds S --fill-seconds S --fill-bots N";

struct Common {
    spec: ServerSpec,
    opts: RunOpts,
    levels: Option<Vec<usize>>,
    stop_at_degrade: bool,
}

fn common(m: &mut ArgMap, command: String) -> Result<Common, String> {
    let parse_addr = |k: &str, t: String| {
        t.parse::<SocketAddr>()
            .map_err(|_| format!("{k} must be ip:port, got {t}"))
    };
    let spec = ServerSpec {
        bin: m.take("--server-bin").map(PathBuf::from),
        attach_public: m
            .take("--target")
            .map(|t| parse_addr("--target", t))
            .transpose()?,
        attach_control: m
            .take("--control")
            .map(|t| parse_addr("--control", t))
            .transpose()?,
        attach_pid: m.num("--pid")?,
        dev_auth: m.flag("--dev-auth"),
        build_profile: m.take("--build-profile"),
        extra_args: m
            .take("--server-args")
            .map(|s| s.split_whitespace().map(str::to_string).collect())
            .unwrap_or_default(),
    };
    if spec.bin.is_some() == spec.attach_public.is_some() {
        return Err("give exactly one of --server-bin and --target".into());
    }
    if let Some(c) = spec.attach_control {
        if !c.ip().is_loopback() {
            return Err("--control must be a loopback address".into());
        }
    }
    let levels = m
        .take("--levels")
        .map(|s| {
            s.split(',')
                .map(|x| {
                    x.trim()
                        .parse::<usize>()
                        .map_err(|_| format!("--levels: bad number {x:?}"))
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?;
    let opts = RunOpts {
        label: m.take("--label").unwrap_or_else(|| "run".into()),
        out_dir: m
            .take("--out-dir")
            .map(PathBuf::from)
            .unwrap_or_else(runner::default_out_dir),
        hardware_label: m.take("--hardware-label"),
        emulated: m.flag("--emulated"),
        keep_creds: m.flag("--keep-creds"),
        command,
    };
    if !opts
        .label
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err("--label may use letters, digits, - _ . only".into());
    }
    Ok(Common {
        spec,
        opts,
        levels,
        stop_at_degrade: m.flag("--stop-at-degrade"),
    })
}

async fn real_main() -> Result<(), String> {
    let all: Vec<String> = std::env::args().skip(1).collect();
    let Some((cmd, rest)) = all.split_first() else {
        return Err(USAGE.into());
    };
    let command = format!("rh-load {}", all.join(" "));
    let mut m = ArgMap::parse(rest)?;
    let c = common(&mut m, command)?;
    let mut sc = scenario_from(&mut m)?;
    m.finish()?;
    match cmd.as_str() {
        "run" => {
            let r = runner::run_one(&sc, &c.spec, &c.opts).await?;
            print!("{}", report::summary_text(&r));
            Ok(())
        }
        "sweep" => {
            let levels = c.levels.clone().ok_or("sweep needs --levels a,b,c")?;
            let mut rows = Vec::new();
            for lv in levels {
                sc.matches = lv;
                sc.max_rooms = sc.max_rooms.max(lv + 8);
                sc.validate()?;
                let mut opts = c.opts.clone();
                opts.label = format!("{}-m{lv}", c.opts.label);
                eprintln!(
                    "== sweep level {lv} matches ({} players) ==",
                    sc.total_players()
                );
                let r = runner::run_one(&sc, &c.spec, &opts).await?;
                print!("{}", report::summary_text(&r));
                let row = report::sweep_row(&r);
                let degraded = row["degraded"] == true;
                rows.push(row);
                if degraded && c.stop_at_degrade {
                    eprintln!("== stopping: level {lv} degraded ==");
                    break;
                }
            }
            let table = report::sweep_table(&rows);
            println!("\n{table}");
            let sweep = serde_json::json!({"schema": "rh-load-sweep/1", "label": c.opts.label, "command": c.opts.command, "rows": rows});
            std::fs::write(
                c.opts.out_dir.join(format!("{}-sweep.json", c.opts.label)),
                serde_json::to_string_pretty(&sweep).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            std::fs::write(
                c.opts.out_dir.join(format!("{}-sweep.txt", c.opts.label)),
                table,
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        }
        other => Err(format!("unknown command {other:?}\n{USAGE}")),
    }
}

#[tokio::main]
async fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    if let Err(e) = real_main().await {
        eprintln!("rh-load: {e}");
        std::process::exit(2);
    }
}
