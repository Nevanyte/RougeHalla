//! rh-server: the live authoritative match server.
//!
//!   cargo run --release -p rh-server -- --bind 127.0.0.1:7777 [--self-signed | --tls-cert cert.pem --tls-key key.pem]
//!       [--control 127.0.0.1:7778] [--map parity/maps/seed1.map.json] [--max-rooms 16] [--fill-bots 8]
//!       [--min-players 1] [--lobby-seconds 10] [--fill-seconds 3] [--auth dev|static:<file>]
//!       [--database-url postgres://... [--instance-id id]]   (build with --features postgres)
//!       [--new-profiles-per-hour 30] [--new-profiles-per-ip-per-hour 10] [--passcode-fails-per-minute 6]
//!       [--passcode-fails-per-minute-all 40] [--shop-burst 6] [--shop-per-second 3] [--api-timeout-secs 10]
//!       [--leaderboard-ttl-secs 5] [--api-cors-origins '*'|origin,origin] [--client-ip-header NAME [--trusted-proxies ip,ip]]
//!       (account API: PLAYTEST_PASSCODE env sets the claim passcode; 0 disables a limit; see docs/adr/0006-persistence.md)
//!       [--lease-ttl-secs 120] [--lease-renew-secs 30] [--lease-db-timeout-secs 5]
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
    let cfg = DirectorConfig {
        leases: lease_policy(&args).unwrap_or_else(|e| {
            eprintln!("[server] invalid lease settings: {e}");
            std::process::exit(2);
        }),
        max_rooms: num("--max-rooms", 16.0) as usize,
        fill_bots_to: num("--fill-bots", 0.0) as usize,
        ..DirectorConfig::new(sim, arena)
    };
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
    let director = Director::new(
        cfg,
        Arc::new(persistence),
        Arc::new(auth),
        lifecycle.clone(),
    );
    let app = rh_server::public_router_with_api(director.clone(), account);

    if let Some(control) = arg(&args, "--control") {
        let addr: SocketAddr = control.parse().expect("--control");
        assert!(
            addr.ip().is_loopback(),
            "the control API must bind to loopback"
        );
        let router = rh_server::control_router(director.clone());
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
