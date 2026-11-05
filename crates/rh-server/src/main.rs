//! rh-server: the live authoritative match server.
//!
//!   cargo run --release -p rh-server -- --bind 127.0.0.1:7777 [--self-signed | --tls-cert cert.pem --tls-key key.pem]
//!       [--control 127.0.0.1:7778] [--map parity/maps/seed1.map.json] [--max-rooms 16] [--fill-bots 8]
//!       [--min-players 1] [--lobby-seconds 10] [--fill-seconds 3] [--auth dev|static:<file>]
//!       [--database-url postgres://... [--instance-id id]]   (build with --features postgres)
//!       [--new-profiles-per-hour 30] [--new-profiles-per-ip-per-hour 10] [--passcode-fails-per-minute 6]
//!       [--passcode-fails-per-minute-all 40] [--shop-burst 6] [--shop-per-second 3]
//!       [--lookup-burst 40] [--lookup-per-second 20] [--api-db-concurrency 6] [--api-timeout-secs 10]
//!       [--leaderboard-ttl-secs 5] [--api-cors-origins '*'|origin,origin] [--client-ip-header NAME [--trusted-proxies ip,ip]]
//!       (account API: PLAYTEST_PASSCODE env sets the claim passcode; 0 disables a limit; see docs/adr/0006-persistence.md)
//!       [--lease-ttl-secs 120] [--lease-renew-secs 30] [--lease-db-timeout-secs 5]
//!       [--result-spool <dir> [--result-spool-max 4096] [--result-dead-max 1024] [--result-retry-secs 900]]   (needs postgres + --database-url)
//!
//!       [--control 127.0.0.1:7778 [--control-token-file <file>]] [--require-admit [--admit-ttl-secs 60]]
//!
//! Hosted mode (docs/hosting/CONTROL_API.md): `--require-admit` admits a Hello only with an admit the hosting bridge posted to
//! `/control/admit` (an extra check after the profile credential check; it never replaces it) and creates rooms only through
//! `POST /control/session`. It needs `--control`. `--control-token-file` makes every control request carry
//! `Authorization: Bearer <the file's token>`. A misspelt `--require-*`, `--admit-*` or `--control-*` flag is an error, never
//! silently ignored.
//!
//! `--result-spool` makes each result durable on this host (fsynced record) before the first database attempt and replays
//! leftovers at startup through the fenced store path; without it results are retried in memory only (a process loss
//! loses an unwritten result). A spool survives a process restart on the same volume, NOT host replacement: only the
//! PostgreSQL commit does. See docs/adr/0006-persistence.md, "Addendum: durable result handoff".
//!
//! Without TLS flags it serves plain ws:// (local development only; browsers on https pages require wss://).
//! SIGTERM / Ctrl-C drain: no new admissions, active matches finish, then the process exits.

use rh_server::api::{AccountApi, ApiConfig, CorsPolicy};
use rh_server::director::{Director, DirectorConfig, LeasePolicy};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

/// `--database-url`: profiles, credentials, session leases and results in PostgreSQL (feature `postgres`).
#[cfg(feature = "postgres")]
async fn durable(url: &str, args: &[String]) -> (Persistence, Auth) {
    // The startup schema gate: a database whose `schema_compat.min_binary` is above this binary (an older server meeting a
    // newer, incompatible schema during a rollout) is refused here, with a plain message and a non-zero exit, before the
    // server takes a single connection.
    let store = match rh_persist::Store::connect(url).await {
        Ok(s) => Arc::new(s),
        Err(e @ rh_persist::Error::SchemaTooNew { .. }) => {
            eprintln!("rh-server: {e}");
            std::process::exit(78);
        }
        Err(e) => panic!("connect to PostgreSQL: {e}"),
    };
    store.migrate().await.expect("migrate");
    let owner =
        arg(args, "--instance-id").unwrap_or_else(|| format!("rh-server-{}", std::process::id()));
    (
        Persistence::postgres(store.clone(), owner),
        Auth::Postgres(store),
    )
}

#[cfg(not(feature = "postgres"))]
async fn durable(_: &str, _: &[String]) -> (Persistence, Auth) {
    panic!("--database-url needs a build with `--features postgres`");
}

fn arg(args: &[String], k: &str) -> Option<String> {
    args.iter()
        .position(|a| a == k)
        .and_then(|i| args.get(i + 1).cloned())
}

/// `--result-spool <dir>` with `--result-spool-max` (pending records, default 4096), `--result-dead-max` (dead letters kept,
/// default 1024; at the bound a refused record stays pending and is counted and logged) and
/// `--result-retry-secs` (ALERT threshold, default 900: a result still uncommitted after this long is logged and counted as
/// stuck, repeatedly; it is never dead-lettered for time, a transient error retries forever).
#[cfg(feature = "postgres")]
fn spool_settings(
    args: &[String],
) -> Result<Option<(std::path::PathBuf, rh_server::spool::SpoolConfig)>, String> {
    let Some(dir) = arg(args, "--result-spool") else {
        if args.iter().any(|a| a == "--result-spool") {
            return Err("--result-spool requires a directory".into());
        }
        for k in [
            "--result-spool-max",
            "--result-dead-max",
            "--result-retry-secs",
        ] {
            if args.iter().any(|a| a == k) {
                return Err(format!("{k} needs --result-spool"));
            }
        }
        return Ok(None);
    };
    if dir.starts_with("--") || dir.is_empty() {
        return Err("--result-spool requires a directory".into());
    }
    let whole = |name: &str| -> Result<Option<u64>, String> {
        match args.iter().position(|a| a == name) {
            None => Ok(None),
            Some(i) => args
                .get(i + 1)
                .and_then(|s| s.parse::<u64>().ok())
                .filter(|n| *n > 0)
                .map(Some)
                .ok_or_else(|| format!("{name} requires a positive whole number")),
        }
    };
    let mut cfg = rh_server::spool::SpoolConfig::default();
    if let Some(n) = whole("--result-spool-max")? {
        cfg.max_records = usize::try_from(n).map_err(|_| "--result-spool-max too large")?;
    }
    if let Some(n) = whole("--result-dead-max")? {
        cfg.max_dead = usize::try_from(n).map_err(|_| "--result-dead-max too large")?;
    }
    if let Some(n) = whole("--result-retry-secs")? {
        cfg.retry_deadline = Duration::from_secs(n);
    }
    Ok(Some((dir.into(), cfg)))
}

/// Hosted-mode settings: `--require-admit`, `--admit-ttl-secs`, `--control-token-file`. Unknown flags in these families are
/// refused (a typo must not silently turn a hosted server into an open one).
struct HostedSettings {
    require_admit: bool,
    admit_ttl: Option<Duration>,
    token: Option<String>,
}

fn hosted_settings(args: &[String]) -> Result<HostedSettings, String> {
    const KNOWN: [&str; 4] = [
        "--require-admit",
        "--admit-ttl-secs",
        "--control-token-file",
        "--control",
    ];
    for a in args.iter().skip(1) {
        let family =
            a.starts_with("--require") || a.starts_with("--admit") || a.starts_with("--control");
        if family && !KNOWN.contains(&a.as_str()) {
            return Err(format!("unknown flag {a} (did you mean one of {KNOWN:?}?)"));
        }
    }
    let admit_ttl = match args.iter().position(|a| a == "--admit-ttl-secs") {
        None => None,
        Some(i) => Some(
            args.get(i + 1)
                .and_then(|s| s.parse::<u64>().ok())
                .filter(|n| (1..=300).contains(n))
                .map(Duration::from_secs)
                .ok_or("--admit-ttl-secs requires a whole number of seconds, 1..=300")?,
        ),
    };
    let token = match args.iter().position(|a| a == "--control-token-file") {
        None => None,
        Some(i) => {
            let path = args
                .get(i + 1)
                .filter(|p| !p.starts_with("--"))
                .ok_or("--control-token-file requires a file")?;
            let text = std::fs::read_to_string(path)
                .map_err(|e| format!("cannot read --control-token-file {path}: {e}"))?;
            let t = text.trim().to_string();
            if t.is_empty() || t.len() > 4096 || t.chars().any(char::is_control) {
                return Err(
                    "--control-token-file must hold one non-empty token (at most 4096 bytes)"
                        .into(),
                );
            }
            Some(t)
        }
    };
    let require_admit = args.iter().any(|a| a == "--require-admit");
    if (require_admit || token.is_some()) && !args.iter().any(|a| a == "--control") {
        return Err(
            "--require-admit and --control-token-file need --control (the control listener)".into(),
        );
    }
    Ok(HostedSettings {
        require_admit,
        admit_ttl,
        token,
    })
}

fn lease_policy(args: &[String]) -> Result<LeasePolicy, String> {
    let defaults = LeasePolicy::default();
    let seconds = |name: &str, default: Duration| -> Result<Duration, String> {
        match args.iter().position(|a| a == name) {
            None => Ok(default),
            Some(i) => args
                .get(i + 1)
                .and_then(|s| s.parse::<u64>().ok())
                .map(Duration::from_secs)
                .ok_or_else(|| format!("{name} requires a whole number of seconds")),
        }
    };
    let policy = LeasePolicy {
        ttl: seconds("--lease-ttl-secs", defaults.ttl)?,
        renew_interval: seconds("--lease-renew-secs", defaults.renew_interval)?,
        db_timeout: seconds("--lease-db-timeout-secs", defaults.db_timeout)?,
    };
    policy.validate().map_err(str::to_owned)?;
    Ok(policy)
}

/// Account API settings. The passcode comes from `PLAYTEST_PASSCODE` (the legacy name), never from argv, so it cannot show in a
/// process list. A limit of 0 turns that guard off (an edge limiter then owns it).
fn api_config(args: &[String]) -> Result<ApiConfig, String> {
    let mut cfg = ApiConfig {
        passcode: std::env::var("PLAYTEST_PASSCODE")
            .ok()
            .filter(|p| !p.is_empty()),
        ..ApiConfig::default()
    };
    let int = |name: &str, default: u32| -> Result<u32, String> {
        match arg(args, name) {
            None => Ok(default),
            Some(v) => v
                .parse()
                .map_err(|_| format!("{name} requires a non-negative whole number")),
        }
    };
    cfg.new_profiles_per_hour = int("--new-profiles-per-hour", cfg.new_profiles_per_hour)?;
    cfg.new_profiles_per_ip_per_hour = int(
        "--new-profiles-per-ip-per-hour",
        cfg.new_profiles_per_ip_per_hour,
    )?;
    cfg.passcode_fails_per_minute =
        int("--passcode-fails-per-minute", cfg.passcode_fails_per_minute)?;
    cfg.passcode_fails_per_minute_all = int(
        "--passcode-fails-per-minute-all",
        cfg.passcode_fails_per_minute_all,
    )?;
    cfg.shop_burst = f64::from(int("--shop-burst", cfg.shop_burst as u32)?);
    cfg.shop_per_second = f64::from(int("--shop-per-second", cfg.shop_per_second as u32)?);
    cfg.lookup_burst = f64::from(int("--lookup-burst", cfg.lookup_burst as u32)?);
    cfg.lookup_per_second = f64::from(int("--lookup-per-second", cfg.lookup_per_second as u32)?);
    cfg.db_concurrency = int("--api-db-concurrency", cfg.db_concurrency as u32)? as usize;
    cfg.request_timeout = Duration::from_secs(u64::from(int("--api-timeout-secs", 10)?.max(1)));
    cfg.leaderboard_ttl = Duration::from_secs(u64::from(int("--leaderboard-ttl-secs", 5)?));
    if let Some(list) = arg(args, "--api-cors-origins") {
        cfg.cors = if list.trim() == "*" {
            CorsPolicy::Any
        } else {
            CorsPolicy::Origins(
                list.split(',')
                    .map(|o| o.trim().trim_end_matches('/').to_ascii_lowercase())
                    .filter(|o| !o.is_empty())
                    .collect(),
            )
        };
    }
    if let Some(name) = arg(args, "--client-ip-header") {
        cfg.client_ip_header = Some(
            name.parse()
                .map_err(|_| format!("--client-ip-header: {name:?} is not a header name"))?,
        );
    }
    if let Some(list) = arg(args, "--trusted-proxies") {
        for p in list.split(',').filter(|p| !p.trim().is_empty()) {
            cfg.trusted_proxies.push(
                p.trim()
                    .parse()
                    .map_err(|_| format!("--trusted-proxies: {p:?} is not an IP address"))?,
            );
        }
    }
    Ok(cfg)
}

#[tokio::main]
async fn main() {
    // One explicit TLS crypto provider (ring): with none selected rustls panics at the first handshake.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let args: Vec<String> = std::env::args().collect();
    let bind: SocketAddr = arg(&args, "--bind")
        .unwrap_or_else(|| "127.0.0.1:7777".into())
        .parse()
        .expect("--bind");
    let arena = match arg(&args, "--map") {
        Some(p) => rh_headless::load_arena(&p).unwrap_or_else(|e| panic!("{e}")),
        None => rh_sim::arenas::practice_arena(),
    };
    if let Err(e) = rh_server::wire::arena_fits(&arena) {
        eprintln!("[server] refusing to host this arena: {e}");
        std::process::exit(2);
    }
    let num = |k: &str, d: f64| {
        arg(&args, k)
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(d)
    };
    let sim = rh_sim::SimConfig {
        min_players: num("--min-players", 2.0) as usize,
        lobby_seconds: num("--lobby-seconds", 30.0),
        fill_seconds: num("--fill-seconds", 5.0),
        pvp_rules: true,
        weapon_specials: true,
        faction_mode: rh_sim::FactionMode::Off,
    };
    let hosted = hosted_settings(&args).unwrap_or_else(|e| {
        eprintln!("[server] invalid hosting settings: {e}");
        std::process::exit(2);
    });
    let mut cfg = DirectorConfig {
        leases: lease_policy(&args).unwrap_or_else(|e| {
            eprintln!("[server] invalid lease settings: {e}");
            std::process::exit(2);
        }),
        max_rooms: num("--max-rooms", 16.0) as usize,
        fill_bots_to: num("--fill-bots", 0.0) as usize,
        ..DirectorConfig::new(sim, arena)
    };
    cfg.require_admit = hosted.require_admit;
    if let Some(ttl) = hosted.admit_ttl {
        cfg.admit_ttl = ttl;
    }
    let auth = match arg(&args, "--auth").as_deref() {
        None | Some("dev") => Auth::Dev,
        Some(s) if s.starts_with("static:") => {
            let text = std::fs::read_to_string(&s[7..])
                .expect("static auth file: lines of `callsign token`");
            Auth::Static(
                text.lines()
                    .filter_map(|l| l.split_once(' '))
                    .map(|(c, t)| (c.to_ascii_lowercase(), t.trim().to_string()))
                    .collect(),
            )
        }
        Some(other) => panic!("unknown --auth {other}"),
    };
    let lifecycle = Arc::new(Lifecycle::default());
    let (persistence, auth) = match arg(&args, "--database-url") {
        None => (Persistence::memory(), auth),
        Some(url) => durable(&url, &args).await,
    };
    let api_cfg = api_config(&args).unwrap_or_else(|e| {
        eprintln!("[server] invalid account API settings: {e}");
        std::process::exit(2);
    });
    #[cfg(feature = "postgres")]
    let account = match &auth {
        Auth::Postgres(store) => AccountApi::postgres(store.clone(), api_cfg),
        _ => AccountApi::disabled(api_cfg),
    };
    #[cfg(not(feature = "postgres"))]
    let account = AccountApi::disabled(api_cfg);
    #[cfg(feature = "postgres")]
    let spool = match spool_settings(&args) {
        Ok(None) => None,
        Ok(Some((dir, scfg))) => {
            if arg(&args, "--database-url").is_none() {
                eprintln!("[server] --result-spool needs --database-url (a spool replays into PostgreSQL)");
                std::process::exit(2);
            }
            match rh_server::spool::ResultSpool::open(&dir, scfg) {
                Ok(s) => Some(s),
                Err(e) => {
                    eprintln!(
                        "[server] cannot open the result spool {}: {e}",
                        dir.display()
                    );
                    std::process::exit(2);
                }
            }
        }
        Err(e) => {
            eprintln!("[server] invalid result spool settings: {e}");
            std::process::exit(2);
        }
    };
    #[cfg(not(feature = "postgres"))]
    if args.iter().any(|a| a.starts_with("--result-spool")) {
        eprintln!("[server] --result-spool needs a build with `--features postgres`");
        std::process::exit(2);
    }
    #[cfg(feature = "postgres")]
    let director = match spool {
        Some(spool) => Director::new_with_spool(
            cfg,
            Arc::new(persistence),
            Arc::new(auth),
            lifecycle.clone(),
            spool,
        ),
        None => Director::new(
            cfg,
            Arc::new(persistence),
            Arc::new(auth),
            lifecycle.clone(),
        ),
    };
    #[cfg(not(feature = "postgres"))]
    let director = Director::new(
        cfg,
        Arc::new(persistence),
        Arc::new(auth),
        lifecycle.clone(),
    );
    // Replay what an earlier process left in the spool (original fence and metadata), before any admission. This runs in
    // the background against the database: an outage delays the replay, never startup or a tick.
    #[cfg(feature = "postgres")]
    director.recover_spooled();
    let app = rh_server::public_router_with_api(director.clone(), account);

    if let Some(control) = arg(&args, "--control") {
        let addr: SocketAddr = control.parse().expect("--control");
        assert!(
            addr.ip().is_loopback(),
            "the control API must bind to loopback"
        );
        let router = rh_server::control_router_with(
            director.clone(),
            rh_server::control::ControlOptions {
                token: hosted.token.as_deref().map(Arc::from),
            },
        );
        tokio::spawn(async move {
            let l = tokio::net::TcpListener::bind(addr)
                .await
                .expect("bind control");
            // The loopback control socket gets TCP_NODELAY too (one small JSON reply per request).
            use axum::serve::ListenerExt;
            let l = l.tap_io(|tcp| {
                let _ = tcp.set_nodelay(true);
            });
            axum::serve(l, router).await.expect("control server");
        });
    }

    let shutdown_director = director.clone();
    tokio::spawn(async move {
        // SIGTERM is how a container platform (and the hosting bridge) asks a process to stop; Ctrl-C is SIGINT.
        #[cfg(unix)]
        {
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("SIGTERM handler");
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = term.recv() => {}
            }
        }
        #[cfg(not(unix))]
        let _ = tokio::signal::ctrl_c().await;
        eprintln!("[server] draining: no new admissions; active matches finish");
        shutdown_director.drain().await;
    });

    lifecycle.ready();
    let handle = axum_server::Handle::new();
    let h2 = handle.clone();
    let lc = lifecycle.clone();
    let writes = director.clone();
    tokio::spawn(async move {
        lc.terminated.notified().await;
        // Results still being written survive the shutdown (bounded: a dead database cannot hold the process forever).
        if !writes.wait_for_writes(Duration::from_secs(150)).await {
            eprintln!("[server] exiting with result writes still pending");
        }
        h2.graceful_shutdown(Some(Duration::from_secs(5)));
    });
    let tls = if args.iter().any(|a| a == "--self-signed") {
        let cert = rcgen::generate_simple_self_signed(vec!["localhost".into(), "127.0.0.1".into()])
            .expect("self-signed cert");
        Some(
            axum_server::tls_rustls::RustlsConfig::from_pem(
                cert.cert.pem().into_bytes(),
                cert.key_pair.serialize_pem().into_bytes(),
            )
            .await
            .expect("tls config"),
        )
    } else if let (Some(c), Some(k)) = (arg(&args, "--tls-cert"), arg(&args, "--tls-key")) {
        Some(
            axum_server::tls_rustls::RustlsConfig::from_pem_file(c, k)
                .await
                .expect("tls files"),
        )
    } else {
        None
    };
    eprintln!(
        "[server] {} on {bind} | protocol {} content {:016x}",
        if tls.is_some() {
            "wss/https"
        } else {
            "ws/http (dev only)"
        },
        rh_protocol::PROTOCOL_VERSION,
        rh_sim::content::content_hash()
    );
    // The one shared serve path (TCP_NODELAY on plain and TLS sockets); the live tests run the same function.
    rh_server::serve(bind, tls, app, handle)
        .await
        .expect("server");
    eprintln!("[server] terminated");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn lease_cli_accepts_defaults_and_a_valid_override() {
        assert_eq!(lease_policy(&[]).unwrap().ttl, Duration::from_secs(120));
        let policy = lease_policy(&args(&[
            "--lease-ttl-secs",
            "15",
            "--lease-renew-secs",
            "4",
            "--lease-db-timeout-secs",
            "2",
        ]))
        .unwrap();
        assert_eq!(policy.ttl, Duration::from_secs(15));
        assert_eq!(policy.renew_interval, Duration::from_secs(4));
        assert_eq!(policy.db_timeout, Duration::from_secs(2));
        assert_eq!(
            lease_policy(&args(&["--lease-ttl-secs", "3600"]))
                .unwrap()
                .ttl,
            Duration::from_secs(3600)
        );
    }

    #[cfg(feature = "postgres")]
    #[test]
    fn spool_dead_bound_is_a_flag_and_retry_secs_is_only_an_alert_threshold() {
        let (_, cfg) = spool_settings(&args(&["--result-spool", "d", "--result-dead-max", "7"]))
            .unwrap()
            .unwrap();
        assert_eq!(cfg.max_dead, 7);
        assert_eq!(
            cfg.max_records, 4096,
            "dead letters no longer share the pending bound"
        );
        assert!(spool_settings(&args(&["--result-dead-max", "7"])).is_err());
        assert!(spool_settings(&args(&["--result-spool", "d", "--result-dead-max", "0"])).is_err());
    }

    #[test]
    fn hosted_flags_parse_and_a_misspelt_one_is_refused() {
        let off = hosted_settings(&args(&["rh-server", "--bind", "x"])).unwrap();
        assert!(!off.require_admit && off.admit_ttl.is_none() && off.token.is_none());
        let on = hosted_settings(&args(&[
            "rh-server",
            "--control",
            "127.0.0.1:1",
            "--require-admit",
            "--admit-ttl-secs",
            "30",
        ]))
        .unwrap();
        assert!(on.require_admit);
        assert_eq!(on.admit_ttl, Some(Duration::from_secs(30)));
        for bad in [
            vec!["rh-server", "--control", "x", "--require-admt"],
            vec!["rh-server", "--control", "x", "--require-admit=true"],
            vec!["rh-server", "--control", "x", "--admit-ttl", "5"],
            vec!["rh-server", "--control-tokenfile", "f", "--control", "x"],
            vec!["rh-server", "--require-admit"],
            vec!["rh-server", "--control", "x", "--admit-ttl-secs", "0"],
            vec!["rh-server", "--control", "x", "--admit-ttl-secs", "301"],
            vec!["rh-server", "--control", "x", "--control-token-file"],
            vec![
                "rh-server",
                "--control",
                "x",
                "--control-token-file",
                "/nonexistent/token",
            ],
        ] {
            assert!(hosted_settings(&args(&bad)).is_err(), "{bad:?}");
        }
    }

    #[cfg(feature = "postgres")]
    #[test]
    fn spool_cli_is_optional_validated_and_bounded() {
        assert!(spool_settings(&[]).unwrap().is_none());
        let (dir, cfg) = spool_settings(&args(&[
            "--result-spool",
            "/var/rh/spool",
            "--result-spool-max",
            "10",
            "--result-retry-secs",
            "60",
        ]))
        .unwrap()
        .unwrap();
        assert_eq!(dir, std::path::PathBuf::from("/var/rh/spool"));
        assert_eq!(cfg.max_records, 10);
        assert_eq!(cfg.retry_deadline, Duration::from_secs(60));
        for bad in [
            vec!["--result-spool"],
            vec!["--result-spool", "--bind"],
            vec!["--result-spool-max", "5"],
            vec!["--result-spool", "d", "--result-spool-max", "0"],
            vec!["--result-spool", "d", "--result-retry-secs", "x"],
        ] {
            assert!(spool_settings(&args(&bad)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn lease_cli_refuses_invalid_values_and_expiry_without_renewal_headroom() {
        for values in [
            vec!["--lease-ttl-secs"],
            vec!["--lease-ttl-secs", "NaN"],
            vec!["--lease-ttl-secs", "-1"],
            vec!["--lease-ttl-secs", "0"],
            vec!["--lease-ttl-secs", "35"],
            vec!["--lease-ttl-secs", "3601"],
            vec!["--lease-renew-secs", "0"],
            vec!["--lease-db-timeout-secs", "0"],
            vec!["--lease-ttl-secs", "18446744073709551615"],
        ] {
            assert!(lease_policy(&args(&values)).is_err(), "{values:?}");
        }
    }
}
