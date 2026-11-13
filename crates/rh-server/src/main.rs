//! rh-server: the live authoritative match server.
//!
//!   cargo run --release -p rh-server -- --bind 127.0.0.1:7777 [--self-signed | --tls-cert cert.pem --tls-key key.pem]
//!       [--runtime core|source-arena|training] (one configured profile per endpoint; source-arena requires --map)
//!       [--hitboxes legacy|archetypes] (ADR0024; default legacy on every path; archetypes opts in to the measured boxes)
//!       [--first-playable] (embedded small PvE/loot map; drain at4h, forced process stop by4h+180s)
//!       [--control 127.0.0.1:7778] [--map parity/maps/seed1.map.json] [--max-rooms 16] [--fill-bots 8]
//!       [--min-players 1] [--lobby-seconds 10] [--fill-seconds 3] [--lobby-timing legacy|matchmaking] [--auth dev|static:<file>]
//!       [--database-url postgres://... [--instance-id id]]   (build with --features postgres)
//!       [--bot-learning off|single-writer]   (default off; single-writer needs PostgreSQL and its exclusive lease)
//!       [--bot-brain off|full]   (default off: fill bots play HumanBot; full seats the ported Brain, HumanBot as its fallback)
//!       [--new-profiles-per-hour 30] [--new-profiles-per-ip-per-hour 10] [--passcode-fails-per-minute 6]
//!       [--passcode-fails-per-minute-all 40] [--shop-burst 6] [--shop-per-second 3]
//!       [--lookup-burst 40] [--lookup-per-second 20] [--api-db-concurrency 6] [--api-timeout-secs 10]
//!       [--leaderboard-ttl-secs 5] [--api-cors-origins '*'|origin,origin] [--client-ip-header NAME [--trusted-proxies ip,ip]]
//!       (account API: PLAYTEST_PASSCODE env sets the claim passcode; 0 disables a limit; see docs/adr/0006-persistence.md)
//!       [--lease-ttl-secs 120] [--lease-renew-secs 30] [--lease-db-timeout-secs 5]
//!       [--result-spool <dir> [--result-spool-max 4096] [--result-dead-max 1024] [--result-retry-secs 900]]   (needs postgres + --database-url)
//!       [--db-connect-timeout-secs 60] [--drain-max-secs 55] [--drain-write-wait-secs 20]   (see the shutdown budget below)
//!
//!       [--control 127.0.0.1:7778 (--control-token-file <file> | --control-insecure-loopback)] [--require-admit [--admit-ttl-secs 60]]
//!       [--ws-origins '*'|origin,origin (default: --api-cors-origins)] [--ws-max-per-ip 16] [--ws-connect-burst 20]
//!       [--ws-connect-per-second 2] [--ws-max-pending 256] [--ws-auth-fails-per-minute 10]
//!       [--ws-auth-fails-per-minute-all 0] [--http-header-timeout-secs 10] (public edge, src/edge.rs; 0 disables a limit)
//!       [--insecure-dev-auth] [--insecure-self-signed]
//!
//! Public exposure (a non-loopback `--bind`, or `--client-ip-header`, which means a reverse proxy forwards public traffic):
//! the server refuses to start with dev auth (no `--database-url`, `--auth` absent or `dev`: any callsign with any ticket)
//! unless `--insecure-dev-auth` is passed, and refuses `--self-signed` unless `--insecure-self-signed` is passed. With an
//! empty origin list `/ws` accepts any browser origin only when not publicly exposed; otherwise browser origins are refused.
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
//! SIGTERM / Ctrl-C drain: no new admissions, active matches finish, then the process exits. `--drain-max-secs N` (default 55,
//! 0 = no cap) is one deadline from the signal: the matches still running near it are ended (seats closed out, earned results
//! kept) and anything still unresponsive at N is abandoned. `--drain-write-wait-secs N` (default 20) bounds the wait for
//! result writes, then 5 s of HTTP shutdown. Total from SIGTERM <= drain-max + write-wait + 5 s = 80 s by default, inside
//! systemd's default 90 s `TimeoutStopSec`, which the hosting units use. Raise both only with a longer termination grace.
//!
//! `--control` requires `--control-token-file <file>` (every control request then carries the bearer token) unless
//! `--control-insecure-loopback` states that loopback alone is acceptable (local development, load tests).
//!
//! `--database-url` retries an unreachable database for `--db-connect-timeout-secs N` (default 60; 0 = one attempt) with
//! exponential backoff, then exits 69 (schema migration failure: 70; schema newer than this binary: 78; bad flags: 2).
//! Log lines never carry the connection string.

use rh_server::api::{AccountApi, ApiConfig, CorsPolicy};
use rh_server::director::{Director, DirectorConfig, LeasePolicy};
use rh_server::edge::{EdgeConfig, HttpLimits, OriginPolicy};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

/// Exit codes the supervisor can act on (besides 2 = bad command line, 78 = schema newer than this binary).
#[cfg(feature = "postgres")]
const EXIT_DB_UNREACHABLE: i32 = 69; // EX_UNAVAILABLE: PostgreSQL did not accept a connection within the connect budget
#[cfg(feature = "postgres")]
const EXIT_DB_MIGRATE: i32 = 70; // EX_SOFTWARE: connected, but the schema migration failed

/// The value of `name` when given: `Ok(None)` when absent, an error when the flag has no value after it.
fn flag_value(args: &[String], name: &str) -> Result<Option<String>, String> {
    match args.iter().position(|a| a == name) {
        None => Ok(None),
        Some(i) => args
            .get(i + 1)
            .filter(|v| !v.starts_with("--"))
            .cloned()
            .map(Some)
            .ok_or_else(|| format!("{name} requires a value")),
    }
}

/// `--db-connect-timeout-secs` (default 60; 0 = one attempt): how long startup keeps retrying an unreachable database.
#[cfg(any(feature = "postgres", test))]
fn db_connect_budget(args: &[String]) -> Result<Duration, String> {
    match flag_value(args, "--db-connect-timeout-secs")? {
        None => Ok(Duration::from_secs(60)),
        Some(v) => v
            .parse::<u64>()
            .ok()
            .filter(|n| *n <= 3600)
            .map(Duration::from_secs)
            .ok_or_else(|| "--db-connect-timeout-secs requires whole seconds, 0..=3600".into()),
    }
}

/// Retries `op` with exponential backoff (`first_delay`, doubling, capped at `max_delay`) until it succeeds, `fatal` says the
/// error cannot be cured by waiting, or `budget` is spent (one attempt when it is zero). The last error is returned.
#[cfg(any(feature = "postgres", test))]
async fn retry_with_backoff<T, E, Fut>(
    budget: Duration,
    first_delay: Duration,
    max_delay: Duration,
    fatal: impl Fn(&E) -> bool,
    show: impl Fn(&E) -> String,
    mut op: impl FnMut(u32) -> Fut,
) -> Result<T, E>
where
    Fut: std::future::Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    let started = tokio::time::Instant::now();
    let mut delay = first_delay;
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        match op(attempt).await {
            Ok(v) => return Ok(v),
            Err(e) => {
                let left = budget.saturating_sub(started.elapsed());
                if fatal(&e) || left.is_zero() {
                    return Err(e);
                }
                let wait = delay.min(left);
                eprintln!(
                    "[server] database not reachable (attempt {attempt}): {}; retrying in {}ms ({}s of budget left)",
                    show(&e),
                    wait.as_millis(),
                    left.as_secs()
                );
                tokio::time::sleep(wait).await;
                delay = (delay * 2).min(max_delay);
            }
        }
    }
}

/// Removes the connection string, and its password and user, from text that is about to be logged. sqlx messages normally
/// carry none of them, but the log must never depend on that.
#[cfg(any(feature = "postgres", test))]
fn redact_secrets(text: &str, url: &[&str]) -> String {
    let mut out = text.to_string();
    for u in url {
        if u.is_empty() {
            continue;
        }
        out = out.replace(u, "<database-url>");
        if let Some((_, rest)) = u.split_once("://") {
            if let Some((cred, _)) = rest.split_once('@') {
                let mut parts = cred.splitn(2, ':');
                let user = parts.next().unwrap_or("");
                if let Some(pw) = parts.next().filter(|p| !p.is_empty()) {
                    out = out.replace(pw, "<redacted>");
                }
                if user.len() > 2 {
                    out = out.replace(user, "<user>");
                }
            }
        }
    }
    out
}

/// One failed connection attempt: the store's own error, or our per-attempt timeout (which is transient, never fatal).
#[cfg(feature = "postgres")]
enum ConnectFail {
    Store(rh_persist::Error),
    Timeout(u64),
}

#[cfg(feature = "postgres")]
impl std::fmt::Display for ConnectFail {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectFail::Store(e) => write!(f, "{e}"),
            ConnectFail::Timeout(s) => write!(f, "no answer within {s}s"),
        }
    }
}

#[cfg(feature = "postgres")]
impl ConnectFail {
    /// Waiting cannot cure it: a schema too new for this binary, or a configuration/credential/database-name error.
    fn fatal(&self) -> bool {
        matches!(self, ConnectFail::Store(e)
            if matches!(e, rh_persist::Error::SchemaTooNew { .. }) || e.is_startup_fatal())
    }
}

/// `--database-url`: profiles, credentials, session leases and results in PostgreSQL (feature `postgres`).
#[cfg(feature = "postgres")]
async fn durable(url: &str, args: &[String]) -> (Persistence, Auth) {
    let budget = db_connect_budget(args).unwrap_or_else(|e| {
        eprintln!("[server] invalid database settings: {e}");
        std::process::exit(2);
    });
    // The startup schema gate: a database whose `schema_compat.min_binary` is above this binary (an older server meeting a
    // newer, incompatible schema during a rollout) is refused here, with a plain message and a non-zero exit, before the
    // server takes a single connection. An unreachable database is retried with backoff for the connect budget, then the
    // process exits with `EXIT_DB_UNREACHABLE` and a line that carries no connection string.
    // sqlx's own pool keeps retrying a refused connection for 30 s inside one `connect`; each attempt is cut at a third of the
    // budget (1..=10 s) so the retries and the budget are real. With a zero budget (one attempt) it gets a sane 10 s.
    let per_attempt = if budget.is_zero() {
        Duration::from_secs(10)
    } else {
        (budget / 3).clamp(Duration::from_secs(1), Duration::from_secs(10))
    };
    let store = match retry_with_backoff(
        budget,
        Duration::from_millis(500),
        Duration::from_secs(8),
        ConnectFail::fatal,
        |e: &ConnectFail| redact_secrets(&e.to_string(), &[url]),
        |_| async move {
            match tokio::time::timeout(per_attempt, rh_persist::Store::connect(url)).await {
                Ok(r) => r.map_err(ConnectFail::Store),
                Err(_) => Err(ConnectFail::Timeout(per_attempt.as_secs())),
            }
        },
    )
    .await
    {
        Ok(s) => Arc::new(s),
        Err(ConnectFail::Store(e @ rh_persist::Error::SchemaTooNew { .. })) => {
            eprintln!("rh-server: {e}");
            std::process::exit(78);
        }
        Err(e) => {
            // A fatal error (bad URL, rejected credentials, missing database) was not retried; the same exit code tells the
            // supervisor the database is not usable, the event name says why.
            let event = if e.fatal() {
                "database_connect_refused_permanently"
            } else {
                "database_unreachable"
            };
            eprintln!(
                "[server] ERROR event={event} budget_secs={} detail={:?} action=exit code={EXIT_DB_UNREACHABLE}",
                budget.as_secs(),
                redact_secrets(&e.to_string(), &[url])
            );
            std::process::exit(EXIT_DB_UNREACHABLE);
        }
    };
    if let Err(e) = store.migrate().await {
        eprintln!(
            "[server] ERROR event=database_migrate_failed detail={:?} action=exit code={EXIT_DB_MIGRATE}",
            redact_secrets(&e.to_string(), &[url])
        );
        std::process::exit(EXIT_DB_MIGRATE);
    }
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

/// Deliberate server-binary opt-in for ordinary human Wish input. Library callers that set `Mode::Full` directly are
/// already explicit; the server's shipped default stays Off.
fn wish_full_enabled(args: &[String]) -> Result<bool, String> {
    let count = args.iter().filter(|a| a.as_str() == "--wish-full").count();
    if args
        .iter()
        .any(|a| a.starts_with("--wish-full=") || a.starts_with("--wish-full-"))
    {
        return Err("--wish-full is a flag without a value".into());
    }
    if count > 1 {
        return Err("--wish-full must occur once".into());
    }
    if let Some(index) = args.iter().position(|a| a == "--wish-full") {
        if args.get(index + 1).is_some_and(|a| !a.starts_with("--")) {
            return Err("--wish-full takes no value".into());
        }
    }
    Ok(count == 1)
}

/// Bounded opt-in service profile, not new simulation rules. Default startup is unchanged.
const FIRST_PLAYABLE_LIFETIME: Duration = Duration::from_secs(4 * 60 * 60);
const FIRST_PLAYABLE_GRACE: Duration = Duration::from_secs(180);
struct FirstPlayable {
    min_players: usize,
    fill_bots: usize,
    lobby_seconds: f64,
    fill_seconds: f64,
}
fn first_playable_settings(args: &[String]) -> Result<Option<FirstPlayable>, String> {
    let count = args
        .iter()
        .filter(|a| a.as_str() == "--first-playable")
        .count();
    if args
        .iter()
        .any(|a| a.starts_with("--first-play") && a != "--first-playable")
    {
        return Err("unknown --first-playable option; use the flag without a value".into());
    }
    if count == 0 {
        return Ok(None);
    }
    if count != 1 {
        return Err("--first-playable must occur once".into());
    }
    let index = args.iter().position(|a| a == "--first-playable").unwrap();
    if args.get(index + 1).is_some_and(|a| !a.starts_with("--")) {
        return Err("--first-playable takes no value".into());
    }
    for flag in [
        "--min-players",
        "--fill-bots",
        "--lobby-seconds",
        "--fill-seconds",
        "--lobby-timing",
    ] {
        if args.iter().any(|a| a.starts_with(&format!("{flag}="))) {
            return Err(format!("use {flag} with a separate value"));
        }
    }
    if args.iter().any(|a| a == "--map" || a.starts_with("--map=")) {
        return Err("--first-playable uses the embedded map; --map cannot override it".into());
    }
    let whole = |flag: &str, default: usize, minimum: usize| -> Result<usize, String> {
        let mut found = args.iter().enumerate().filter(|(_, a)| a.as_str() == flag);
        let value = match found.next() {
            None => return Ok(default),
            Some((i, _)) => args
                .get(i + 1)
                .and_then(|v| v.parse::<usize>().ok())
                .ok_or_else(|| format!("{flag} requires a whole seat count"))?,
        };
        if found.next().is_some() || !(minimum..=rh_sim::constants::MAX_PLAYERS).contains(&value) {
            return Err(format!("{flag} must occur once with {minimum}..=8 seats"));
        }
        Ok(value)
    };
    let seconds = |flag: &str, default: f64| -> Result<f64, String> {
        let mut found = args.iter().enumerate().filter(|(_, a)| a.as_str() == flag);
        let value = match found.next() {
            None => return Ok(default),
            Some((i, _)) => args
                .get(i + 1)
                .and_then(|v| v.parse::<f64>().ok())
                .ok_or_else(|| format!("{flag} requires seconds"))?,
        };
        if found.next().is_some()
            || !value.is_finite()
            || value < 0.
            || !(value * 1000.).is_finite()
        {
            return Err(format!("{flag} requires finite nonnegative seconds"));
        }
        Ok(value)
    };
    Ok(Some(FirstPlayable {
        min_players: whole("--min-players", 2, 1)?,
        fill_bots: whole("--fill-bots", 0, 0)?,
        lobby_seconds: seconds("--lobby-seconds", 30.)?,
        fill_seconds: seconds("--fill-seconds", 5.)?,
    }))
}
fn first_playable_arena() -> Result<rh_sim::Arena, String> {
    if rh_sim::constants::MAX_PLAYERS != 8 {
        return Err(
            "first-playable capacity requires the existing eight-seat admission cap".into(),
        );
    }
    let map: rh_sim::mapdata::MapExport =
        serde_json::from_slice(include_bytes!("../../../maps/first-playable.json"))
            .map_err(|e| e.to_string())?;
    if map.legacy_map_hash_u32 != 0x0252_d18b
        || rh_sim::mapgen::map_hash::map_hash(&map.map) != "0252d18b"
    {
        return Err(
            "embedded first-playable map identity changed; review map capacity before enabling"
                .into(),
        );
    }
    map.validate()
        .map_err(|e| e.to_string())?
        .into_arena()
        .map_err(|e| e.to_string())
}
async fn service_deadline(deadline: Option<tokio::time::Instant>) {
    match deadline {
        Some(at) => tokio::time::sleep_until(at).await,
        None => std::future::pending::<()>().await,
    }
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
    const KNOWN: [&str; 5] = [
        "--require-admit",
        "--admit-ttl-secs",
        "--control-token-file",
        "--control-insecure-loopback",
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
    // The control listener can create and end rooms, kick players and drain the process. Loopback is not an authentication
    // boundary on a shared host (any local process, or an SSRF in a sibling service, reaches it), so a token is required
    // unless the operator says, explicitly, that loopback alone is acceptable (local development, load tests).
    let insecure = args.iter().any(|a| a == "--control-insecure-loopback");
    if args.iter().any(|a| a == "--control") && token.is_none() && !insecure {
        return Err(
            "--control needs --control-token-file <file> (control requests then carry `Authorization: Bearer <token>`); \
             pass --control-insecure-loopback to run the control API unauthenticated on loopback (development only)"
                .into(),
        );
    }
    if insecure && !args.iter().any(|a| a == "--control") {
        return Err("--control-insecure-loopback needs --control".into());
    }
    Ok(HostedSettings {
        require_admit,
        admit_ttl,
        token,
    })
}

/// Drain bounds. The hosting stack stops the process with systemd's default `TimeoutStopSec` (90 s: `render.py` and
/// `bootstrap.py` set none for `rh-server`), then SIGKILL. From the signal, the process exit is bounded by ONE budget:
///
///   `--drain-max-secs` (everything up to the last room closing, including the forced end) +
///   `--drain-write-wait-secs` (result writes in flight) + `HTTP_SHUTDOWN_GRACE` (5 s) <= `TimeoutStopSec`
///
/// Defaults: 55 + 20 + 5 = 80 s, 10 s of margin under 90 s. A longer grace (container platforms often give 120 s+) can raise
/// both flags; keep the sum within it.
const DEFAULT_DRAIN_MAX: Duration = Duration::from_secs(55);
const DEFAULT_DRAIN_WRITE_WAIT: Duration = Duration::from_secs(20);
const HTTP_SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

struct DrainSettings {
    /// After this long the remaining rooms are ended (results kept); `None` waits for the matches without a cap.
    max: Option<Duration>,
    /// How long the exit waits for result writes still in flight.
    write_wait: Duration,
}

fn drain_settings(args: &[String]) -> Result<DrainSettings, String> {
    let secs = |name: &str, default: Duration, zero_ok: bool| -> Result<Duration, String> {
        match flag_value(args, name)? {
            None => Ok(default),
            Some(v) => v
                .parse::<u64>()
                .ok()
                .filter(|n| (*n > 0 || zero_ok) && *n <= 86_400)
                .map(Duration::from_secs)
                .ok_or_else(|| {
                    format!(
                        "{name} requires whole seconds, {}..=86400",
                        u8::from(!zero_ok)
                    )
                }),
        }
    };
    let max = secs("--drain-max-secs", DEFAULT_DRAIN_MAX, true)?;
    Ok(DrainSettings {
        max: (!max.is_zero()).then_some(max),
        write_wait: secs("--drain-write-wait-secs", DEFAULT_DRAIN_WRITE_WAIT, false)?,
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

/// Whether this process serves public traffic: a non-loopback bind, or a forwarded-address header (a reverse proxy in front
/// of a loopback bind forwards public clients).
fn publicly_exposed(args: &[String], bind: SocketAddr) -> bool {
    !bind.ip().is_loopback() || args.iter().any(|a| a == "--client-ip-header")
}

/// What the startup checks of a publicly exposed process decided; `warnings` are printed before serving.
#[derive(Debug, Default)]
struct Exposure {
    public: bool,
    warnings: Vec<String>,
}

/// Refuses settings that are unsafe on a public listener unless explicitly accepted: dev auth (`--insecure-dev-auth`) and the
/// generated self-signed certificate (`--insecure-self-signed`). Also refuses ambiguous TLS flags and misspelt `--insecure-*`
/// flags (a typo must not silently keep an insecure default).
fn exposure_check(args: &[String], bind: SocketAddr) -> Result<Exposure, String> {
    const KNOWN: [&str; 2] = ["--insecure-dev-auth", "--insecure-self-signed"];
    for a in args.iter().skip(1) {
        if a.starts_with("--insecure") && !KNOWN.contains(&a.as_str()) {
            return Err(format!("unknown flag {a} (did you mean one of {KNOWN:?}?)"));
        }
    }
    let flag = |k: &str| args.iter().any(|a| a == k);
    let public = publicly_exposed(args, bind);
    let mut warnings = vec![];
    let dev_auth = arg(args, "--database-url").is_none()
        && matches!(arg(args, "--auth").as_deref(), None | Some("dev"));
    if dev_auth && public {
        if !flag("--insecure-dev-auth") {
            return Err(format!(
                "refusing to start: dev auth (any callsign is accepted with any ticket) on a publicly exposed listener \
                 ({bind}{}); pass --database-url or --auth static:<file>, or --insecure-dev-auth to accept this deliberately",
                if bind.ip().is_loopback() { ", behind --client-ip-header" } else { "" }
            ));
        }
        warnings.push(format!(
            "INSECURE: --insecure-dev-auth: {bind} accepts ANY callsign with ANY ticket; never use this for real players"
        ));
    }
    let self_signed = flag("--self-signed");
    let (cert, key) = (arg(args, "--tls-cert"), arg(args, "--tls-key"));
    if cert.is_some() != key.is_some()
        || (cert.is_none() && (flag("--tls-cert") || flag("--tls-key")))
    {
        return Err("--tls-cert and --tls-key must be given together, each with a file".into());
    }
    if self_signed && cert.is_some() {
        return Err("--self-signed and --tls-cert/--tls-key are exclusive".into());
    }
    if self_signed && public {
        if !flag("--insecure-self-signed") {
            return Err(format!(
                "refusing to start: --self-signed on a publicly exposed listener ({bind}) serves a throwaway certificate \
                 for localhost that no browser trusts; pass --tls-cert/--tls-key, or --insecure-self-signed to accept this"
            ));
        }
        warnings.push(format!(
            "INSECURE: --insecure-self-signed: {bind} serves a generated localhost certificate; clients cannot verify it"
        ));
    }
    if (flag("--insecure-dev-auth") && !(dev_auth && public))
        || (flag("--insecure-self-signed") && !(self_signed && public))
    {
        warnings
            .push("an --insecure-* flag was given but has no effect with these settings".into());
    }
    Ok(Exposure { public, warnings })
}

/// The public edge settings (`--ws-*`, `--http-header-timeout-secs`). The client-address rules come from the account API's
/// `--client-ip-header`/`--trusted-proxies` (one parse, one trust rule). `--ws-origins` defaults to `--api-cors-origins`; an
/// empty list means any origin when not publicly exposed and no browser origin otherwise.
fn edge_settings(
    args: &[String],
    api: &ApiConfig,
    public: bool,
) -> Result<(EdgeConfig, HttpLimits, Vec<String>), String> {
    const KNOWN: [&str; 7] = [
        "--ws-origins",
        "--ws-max-per-ip",
        "--ws-connect-burst",
        "--ws-connect-per-second",
        "--ws-max-pending",
        "--ws-auth-fails-per-minute",
        "--ws-auth-fails-per-minute-all",
    ];
    for a in args.iter().skip(1) {
        if (a.starts_with("--ws-") && !KNOWN.contains(&a.as_str()))
            || (a.starts_with("--http-") && a != "--http-header-timeout-secs")
        {
            return Err(format!("unknown flag {a}"));
        }
    }
    let int = |name: &str, default: u32| -> Result<u32, String> {
        match args.iter().position(|a| a == name) {
            None => Ok(default),
            Some(i) => args
                .get(i + 1)
                .and_then(|v| v.parse().ok())
                .ok_or_else(|| format!("{name} requires a non-negative whole number")),
        }
    };
    let d = EdgeConfig::default();
    let mut warnings = vec![];
    let listed = match arg(args, "--ws-origins") {
        Some(list) if !list.starts_with("--") => OriginPolicy::parse(&list),
        Some(_) => return Err("--ws-origins requires '*' or a comma list of origins".into()),
        None if args.iter().any(|a| a == "--ws-origins") => {
            return Err("--ws-origins requires '*' or a comma list of origins".into())
        }
        None => match &api.cors {
            CorsPolicy::Any => OriginPolicy::Any,
            CorsPolicy::Origins(list) => OriginPolicy::Only(list.clone()),
        },
    };
    let origins = match listed {
        OriginPolicy::Only(list) if list.is_empty() && !public => OriginPolicy::Any,
        OriginPolicy::Only(list) if list.is_empty() => {
            warnings.push(
                "no --ws-origins/--api-cors-origins on a publicly exposed listener: browsers cannot open /ws \
                 (non-browser clients still can)"
                    .into(),
            );
            OriginPolicy::Only(list)
        }
        OriginPolicy::Any if public => {
            warnings
                .push("/ws accepts any browser origin on a publicly exposed listener ('*')".into());
            OriginPolicy::Any
        }
        other => other,
    };
    let cfg = EdgeConfig {
        origins,
        client_ip_header: api.client_ip_header.clone(),
        trusted_proxies: api.trusted_proxies.clone(),
        max_per_ip: int("--ws-max-per-ip", d.max_per_ip as u32)? as usize,
        connect_burst: f64::from(int("--ws-connect-burst", d.connect_burst as u32)?),
        connect_per_second: f64::from(int("--ws-connect-per-second", d.connect_per_second as u32)?),
        max_pending: int("--ws-max-pending", d.max_pending as u32)? as usize,
        auth_fails_per_minute: int("--ws-auth-fails-per-minute", d.auth_fails_per_minute)?,
        auth_fails_per_minute_all: int(
            "--ws-auth-fails-per-minute-all",
            d.auth_fails_per_minute_all,
        )?,
    };
    let default_secs = HttpLimits::default().header_read_timeout.as_secs() as u32;
    let secs = int("--http-header-timeout-secs", default_secs)?;
    if !(1..=300).contains(&secs) {
        return Err("--http-header-timeout-secs must be 1..=300".into());
    }
    let limits = HttpLimits {
        header_read_timeout: Duration::from_secs(u64::from(secs)),
    };
    Ok((cfg, limits, warnings))
}

#[tokio::main]
async fn main() {
    let process_started = tokio::time::Instant::now();
    // One explicit TLS crypto provider (ring): with none selected rustls panics at the first handshake.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let args: Vec<String> = std::env::args().collect();
    let runtime = rh_server::runtime::Settings::from_args(&args).unwrap_or_else(|e| {
        eprintln!("[server] invalid runtime settings: {e}");
        std::process::exit(2);
    });
    let training = runtime
        .as_ref()
        .is_some_and(|p| p.profile == rh_server::runtime::Profile::Training);
    let first_playable = first_playable_settings(&args).unwrap_or_else(|e| {
        eprintln!("[server] invalid first-playable settings: {e}");
        std::process::exit(2);
    });
    let wish_full = wish_full_enabled(&args).unwrap_or_else(|e| {
        eprintln!("[server] invalid Wish settings: {e}");
        std::process::exit(2);
    });
    let profile_enabled = first_playable.is_some();
    if profile_enabled {
        // Absolute watchdog is independent of signals, control/drain, room completion and pending writes.
        tokio::spawn(async move {
            service_deadline(Some(
                process_started + FIRST_PLAYABLE_LIFETIME + FIRST_PLAYABLE_GRACE,
            ))
            .await;
            eprintln!("[server] first-playable process lifetime exhausted; stopping (configured durable spool owns pending-write recovery)");
            std::process::exit(0);
        });
    }
    let bind: SocketAddr = arg(&args, "--bind")
        .unwrap_or_else(|| "127.0.0.1:7777".into())
        .parse()
        .expect("--bind");
    let exposure = exposure_check(&args, bind).unwrap_or_else(|e| {
        eprintln!("[server] {e}");
        std::process::exit(2);
    });
    let arena = if let Some(runtime) = &runtime {
        runtime.arena().unwrap_or_else(|e| {
            eprintln!("[server] invalid runtime map: {e}");
            std::process::exit(2);
        })
    } else if profile_enabled {
        first_playable_arena().unwrap_or_else(|e| panic!("embedded first-playable map: {e}"))
    } else {
        match arg(&args, "--map") {
            Some(p) => rh_headless::load_arena(&p).unwrap_or_else(|e| panic!("{e}")),
            None => rh_sim::arenas::practice_arena(),
        }
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
    // `--hitboxes` takes effect on the core path too (ADR0024 review finding 9); a runtime parsed its own.
    let core_hitboxes = rh_server::runtime::core_hitboxes(&args).unwrap_or_else(|e| {
        eprintln!("[server] invalid hitbox settings: {e}");
        std::process::exit(2);
    });
    let sim = runtime.as_ref().map_or_else(
        || rh_sim::SimConfig {
            hitboxes: core_hitboxes,
            mob_spacing: Default::default(),
            regen_in_combat: rh_sim::RegenInCombat::Legacy,
            camp_buffs: rh_sim::CampBuffRule::Legacy,
            walk_hints: None,
            regen: false,
            quests: false,
            training: false,
            dummies: false,
            hazards: rh_sim::terrain::Mode::Off,
            abilities: if wish_full {
                rh_sim::abilities::Mode::Full
            } else {
                rh_sim::abilities::Mode::Off
            },
            wish_lock_ms: rh_sim::abilities::WISH_LOCK_MS,
            lifecycle: rh_sim::ArenaMode::Off,
            mob_mode: if profile_enabled {
                rh_sim::mob_runtime::MobMode::Pve
            } else {
                rh_sim::mob_runtime::MobMode::Off
            },
            initial_loot: profile_enabled,
            consumables: profile_enabled,
            min_players: first_playable
                .as_ref()
                .map_or_else(|| num("--min-players", 2.0) as usize, |p| p.min_players),
            lobby_seconds: first_playable
                .as_ref()
                .map_or_else(|| num("--lobby-seconds", 30.), |p| p.lobby_seconds),
            fill_seconds: first_playable
                .as_ref()
                .map_or_else(|| num("--fill-seconds", 5.), |p| p.fill_seconds),
            pvp_rules: true,
            weapon_specials: true,
            faction_mode: if profile_enabled {
                rh_sim::FactionMode::EngagementHolyPlagueFire
            } else {
                rh_sim::FactionMode::Off
            },
        },
        |runtime| runtime.sim(),
    );
    if let Err(e) = rh_server::wire::profile_supported(&sim) {
        eprintln!("[server] refusing to host this simulation profile: {e}");
        std::process::exit(2);
    }
    let hosted = hosted_settings(&args).unwrap_or_else(|e| {
        eprintln!("[server] invalid hosting settings: {e}");
        std::process::exit(2);
    });
    let mut cfg = DirectorConfig {
        leases: lease_policy(&args).unwrap_or_else(|e| {
            eprintln!("[server] invalid lease settings: {e}");
            std::process::exit(2);
        }),
        max_rooms: runtime
            .as_ref()
            .map_or_else(|| num("--max-rooms", 16.0) as usize, |p| p.max_rooms),
        fill_bots_to: runtime.as_ref().map_or_else(
            || {
                first_playable
                    .as_ref()
                    .map_or_else(|| num("--fill-bots", 0.) as usize, |p| p.fill_bots)
            },
            |p| p.fill_bots,
        ),
        ..DirectorConfig::new(sim, arena)
    };
    if runtime.as_ref().is_some_and(|r| r.map_pool) {
        // P-MAP-3: certified maps made ahead on a worker thread; the configured --map is the last resort.
        let configured = rh_server::room::MapAssets::new(cfg.arena.clone())
            .unwrap_or_else(|e| panic!("the configured map encodes as a Welcome: {e:?}"));
        let signature = runtime.as_ref().is_some_and(|r| r.signature_landmarks);
        cfg.map_pool = Some(std::sync::Arc::new(rh_server::map_pool::MapPool::start(
            configured, signature,
        )));
        eprintln!(
            "[server] map pool on: each room takes its own certified map (target {})",
            rh_server::map_pool::MAP_POOL_TARGET
        );
    }
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
    if hosted.require_admit && matches!(auth, Auth::Dev) {
        // An admit names a callsign and authenticates nobody; with dev auth any client may claim an admitted seat.
        eprintln!(
            "warning: --require-admit with dev auth accepts ANY ticket for an admitted callsign; \
             pass --database-url or --auth static:<file> on a public host"
        );
    }
    // Parse the source gate before any learning I/O; Off overrides an otherwise valid explicit activation.
    let env_lookup = |key: &str| std::env::var(key).ok();
    let startup_fill = rh_server::bot_fill::BotFillConfig::from_env(env_lookup);
    let learning_allowed = startup_fill.learning_enabled();
    // Explicit opt-in only: ordinary database/profile writers never start learning implicitly.
    let requested_learning_mode = rh_server::bot_learning::LearningMode::from_args(&args)
        .unwrap_or_else(|error| {
            eprintln!("[server] {error}");
            std::process::exit(2);
        });
    if training && requested_learning_mode != rh_server::bot_learning::LearningMode::Off {
        eprintln!("[server] training does not run bot learning");
        std::process::exit(2);
    }
    let learning_mode = if learning_allowed {
        requested_learning_mode
    } else {
        rh_server::bot_learning::LearningMode::Off
    };
    if learning_mode == rh_server::bot_learning::LearningMode::SingleWriter
        && matches!(persistence, Persistence::Memory(_))
    {
        eprintln!("[server] --bot-learning single-writer requires PostgreSQL");
        std::process::exit(2);
    }
    #[cfg(feature = "postgres")]
    let learning: Option<
        Arc<rh_server::bot_learning::LiveLearning<rh_server::bot_learning::PgBackend>>,
    > = if learning_mode == rh_server::bot_learning::LearningMode::SingleWriter {
        if let Persistence::Postgres { store, .. } = &persistence {
            let budget = rh_server::bot_learning::LearningBudget::default();
            let acquired = tokio::time::timeout(
                budget.attempt,
                rh_server::bot_learning::PgBackend::acquire(store.pool()),
            )
            .await;
            match acquired {
                Ok(Ok(Some(backend))) => {
                    let clock = Arc::new(|| {
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_millis() as i64)
                            .unwrap_or(0)
                    });
                    match rh_server::bot_learning::LiveLearning::start(backend, clock).await {
                        Ok(live) => Some(live),
                        Err(error) => {
                            eprintln!("[server] learning disabled: {error}");
                            None
                        }
                    }
                }
                Ok(Ok(None)) => {
                    eprintln!("[server] learning disabled: database writer lease busy");
                    None
                }
                Ok(Err(error)) => {
                    eprintln!("[server] learning disabled: {error}");
                    None
                }
                Err(_) => {
                    eprintln!("[server] learning disabled: writer acquisition deadline exceeded");
                    None
                }
            }
        } else {
            None
        }
    } else {
        None
    };
    #[cfg(feature = "postgres")]
    let learning_snapshot = learning.as_ref().map(|live| live.snapshot());
    #[cfg(not(feature = "postgres"))]
    let learning_snapshot: Option<rh_policy::bots::learning::LearnedBias> = None;
    // The BOTS_* environment supplies the fill policy and --fill-bots (or first-playable) overrides only the count; fill
    // stays off unless one of them asks for it (the Rust server's historical default; the source distribution defaults to
    // 8). The learning snapshot participates under the same BOT_STATS_FILE gate handled inside this composition.
    let cli_fill =
        runtime.is_some() || first_playable.is_some() || arg(&args, "--fill-bots").is_some();
    let mut bot_fill = rh_server::bot_fill::server_fill_config(
        env_lookup,
        cli_fill.then_some(cfg.fill_bots_to),
        learning_snapshot,
    );
    bot_fill.lobby_timing = rh_server::runtime::lobby_timing_flag(&args).unwrap_or_else(|e| {
        eprintln!("[server] invalid lobby timing: {e}");
        std::process::exit(2);
    });
    // P-BOT-BRAIN-LIVE-1: `--bot-brain full` seats the ported Brain (degraded fair profile) for fill bots; off by default.
    bot_fill.brain = rh_server::bot_fill::bot_brain_flag(&args).unwrap_or_else(|e| {
        eprintln!("[server] invalid bot brain: {e}");
        std::process::exit(2);
    });
    // Name exclusion is requested only for an active fill policy. Ordinary profile-only servers need no name snapshot.
    let bot_names = if bot_fill.fill_to > 0 {
        persistence
            .bot_names_for_startup()
            .await
            .unwrap_or_else(|e| {
                eprintln!("[server] {e}");
                std::process::exit(2);
            })
    } else {
        Default::default()
    };
    cfg.fill_bots_to = bot_fill.fill_to;
    cfg.bot_fill = (!training).then_some(bot_fill);
    let api_cfg = api_config(&args).unwrap_or_else(|e| {
        eprintln!("[server] invalid account API settings: {e}");
        std::process::exit(2);
    });
    // The lobby endpoint keys its per-address caps (and its CORS) by the account API's own settings.
    let lobby_cfg = rh_server::lobby::LobbyConfig::from_api(&api_cfg);
    let (edge_cfg, http_limits, edge_warnings) = edge_settings(&args, &api_cfg, exposure.public)
        .unwrap_or_else(|e| {
            eprintln!("[server] invalid edge settings: {e}");
            std::process::exit(2);
        });
    for w in exposure.warnings.iter().chain(&edge_warnings) {
        eprintln!("[server] warning: {w}");
    }
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
    // The record caller and the next lobby's bias snapshot come from the live store (P-BOTS-5).
    #[cfg(feature = "postgres")]
    if let Some(live) = &learning {
        director.install_learning(live.clone());
    }
    // The fill bots' read-only profile-name seam (P-BOTS-7 remainder).
    director.set_bot_names(bot_names);
    // Replay what an earlier process left in the spool (original fence and metadata), before any admission. This runs in
    // the background against the database: an outage delays the replay, never startup or a tick.
    #[cfg(feature = "postgres")]
    director.recover_spooled();
    let app = rh_server::public_router_with_lobby_guarded(
        director.clone(),
        account,
        lobby_cfg,
        rh_server::edge::EdgeGuard::new(edge_cfg),
    );

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

    let drain = drain_settings(&args).unwrap_or_else(|e| {
        eprintln!("[server] invalid drain settings: {e}");
        std::process::exit(2);
    });
    let (drain_max, write_wait) = (drain.max, drain.write_wait);
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
                _ = service_deadline(profile_enabled.then_some(process_started+FIRST_PLAYABLE_LIFETIME)) => {}
            }
        }
        #[cfg(not(unix))]
        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = service_deadline(profile_enabled.then_some(process_started+FIRST_PLAYABLE_LIFETIME)) => {} }
        eprintln!(
            "[server] draining: no new admissions; active matches finish (cap: {})",
            drain_max.map_or("none".to_string(), |d| format!("{}s", d.as_secs()))
        );
        shutdown_director.drain_within(drain_max).await;
    });

    lifecycle.ready();
    let handle = axum_server::Handle::new();
    let h2 = handle.clone();
    let lc = lifecycle.clone();
    let writes = director.clone();
    // The live learning store flushes and closes with the process (the source manager's dispose flush).
    #[cfg(feature = "postgres")]
    let shutdown_learning = learning.clone();
    tokio::spawn(async move {
        lc.terminated.notified().await;
        // Results still being written survive the shutdown (bounded: a dead database cannot hold the process forever).
        if !writes.wait_for_writes(write_wait).await {
            eprintln!("[server] exiting with result writes still pending");
        }
        let shutdown = || h2.graceful_shutdown(Some(HTTP_SHUTDOWN_GRACE));
        #[cfg(feature = "postgres")]
        if let Some(live) = &shutdown_learning {
            let report = rh_server::bot_learning::close_then(live, shutdown).await;
            if !report.flushed {
                eprintln!("[server] learning closed with unflushed statistics: {report:?}");
            }
            return;
        }
        shutdown();
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
    rh_server::serve_with_limits(
        bind,
        tls,
        app,
        handle,
        rh_server::NoDelay::new(),
        http_limits,
    )
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
    fn full_wish_mode_is_a_single_explicit_flag_and_defaults_off() {
        assert!(!wish_full_enabled(&args(&["rh-server"])).unwrap());
        assert!(wish_full_enabled(&args(&["rh-server", "--wish-full"])).unwrap());
        for bad in [
            vec!["--wish-full", "--wish-full"],
            vec!["--wish-full", "true"],
            vec!["--wish-full=true"],
            vec!["--wish-full-extra"],
        ] {
            assert!(wish_full_enabled(&args(&bad)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn first_playable_profile_is_opt_in_and_limits_seat_overrides() {
        assert!(first_playable_settings(&args(&["rh-server"]))
            .unwrap()
            .is_none());
        let profile = first_playable_settings(&args(&[
            "rh-server",
            "--first-playable",
            "--min-players",
            "1",
            "--fill-bots",
            "8",
        ]))
        .unwrap()
        .unwrap();
        assert_eq!(profile.min_players, 1);
        assert_eq!(profile.fill_bots, 8);
        for bad in [
            vec!["--first-playable", "--map", "x"],
            vec!["--first-playable", "--map=x"],
            vec!["--first-playable", "--first-playable"],
            vec!["--first-playable", "true"],
            vec!["--first-playable-lifetime", "99999"],
            vec!["--first-playable", "--fill-bots", "9"],
            vec!["--first-playable", "--fill-bots", "1.5"],
            vec!["--first-playable", "--min-players", "0"],
            vec!["--first-playable", "--min-players", "9"],
            vec!["--first-playable", "--min-players=2"],
            vec!["--first-playable", "--lobby-seconds", "NaN"],
            vec!["--first-playable", "--fill-seconds", "-1"],
            vec!["--first-playable", "--fill-bots", "1", "--fill-bots", "2"],
        ] {
            assert!(first_playable_settings(&args(&bad)).is_err(), "{bad:?}");
        }
    }
    #[test]
    fn embedded_map_is_admitted_and_fits_the_process_budget() {
        let arena = first_playable_arena().unwrap();
        rh_server::wire::arena_fits(&arena).unwrap();
        let data = arena.map.layers().unwrap().data();
        assert_eq!(arena.spawns.len(), 8);
        assert_eq!(data.crate_spots.len(), 8);
        assert_eq!(data.ground_spots.len(), 48);
        assert_eq!(data.camps.iter().map(|c| c.spots.len()).sum::<usize>(), 4);
        assert_eq!(rh_sim::constants::MAX_PLAYERS, 8);
        assert_eq!(rh_sim::constants::CAMP_RESPAWN_MS, 180000.);
        assert_eq!(
            (FIRST_PLAYABLE_LIFETIME + FIRST_PLAYABLE_GRACE).as_secs(),
            14580
        );
        let waves = 1 + 14580 / 180;
        let units = 4 * waves + 48 + 16;
        assert_eq!(8 + 48 + 8 + units, 456);
        assert!(8 + 48 + 8 + units <= 512);
    }
    #[tokio::test(start_paused = true)]
    async fn service_deadlines_are_absolute_and_disabled_has_no_timer() {
        let started = tokio::time::Instant::now();
        let auto = tokio::spawn(service_deadline(Some(started + FIRST_PLAYABLE_LIFETIME)));
        let hard = tokio::spawn(service_deadline(Some(
            started + FIRST_PLAYABLE_LIFETIME + FIRST_PLAYABLE_GRACE,
        )));
        let off = tokio::spawn(service_deadline(None));
        tokio::task::yield_now().await;
        tokio::time::advance(FIRST_PLAYABLE_LIFETIME - Duration::from_secs(1)).await;
        assert!(!auto.is_finished());
        assert!(!hard.is_finished());
        tokio::time::advance(Duration::from_secs(1)).await;
        tokio::task::yield_now().await;
        assert!(auto.is_finished());
        tokio::time::advance(FIRST_PLAYABLE_GRACE).await;
        tokio::task::yield_now().await;
        assert!(hard.is_finished());
        assert!(!off.is_finished());
        off.abort();
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
            "--control-insecure-loopback",
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

    #[test]
    fn a_control_listener_needs_a_token_or_an_explicit_insecure_loopback_flag() {
        let refused = hosted_settings(&args(&["rh-server", "--control", "127.0.0.1:1"]))
            .err()
            .expect("refused");
        assert!(
            refused.contains("--control-token-file")
                && refused.contains("--control-insecure-loopback"),
            "{refused}"
        );
        let dir = std::env::temp_dir().join(format!("rh-ctl-token-unit-{}", std::process::id()));
        std::fs::write(&dir, "tok\n").unwrap();
        let token = hosted_settings(&args(&[
            "rh-server",
            "--control",
            "127.0.0.1:1",
            "--control-token-file",
            dir.to_str().unwrap(),
        ]))
        .unwrap();
        assert_eq!(token.token.as_deref(), Some("tok"));
        let _ = std::fs::remove_file(&dir);
        assert!(hosted_settings(&args(&[
            "rh-server",
            "--control",
            "127.0.0.1:1",
            "--control-insecure-loopback"
        ]))
        .unwrap()
        .token
        .is_none());
        // The opt-out means nothing without a control listener, and no control listener means no requirement.
        assert!(hosted_settings(&args(&["rh-server", "--control-insecure-loopback"])).is_err());
        assert!(hosted_settings(&args(&["rh-server", "--bind", "x"])).is_ok());
    }

    #[test]
    fn drain_and_database_budget_flags_parse_with_safe_defaults() {
        let d = drain_settings(&args(&["rh-server"])).unwrap();
        assert_eq!(d.max, Some(Duration::from_secs(55)));
        assert_eq!(d.write_wait, Duration::from_secs(20));
        assert!(
            d.max.unwrap() + d.write_wait + HTTP_SHUTDOWN_GRACE <= Duration::from_secs(80),
            "inside systemd's default TimeoutStopSec"
        );
        let d = drain_settings(&args(&[
            "rh-server",
            "--drain-max-secs",
            "0",
            "--drain-write-wait-secs",
            "5",
        ]))
        .unwrap();
        assert_eq!((d.max, d.write_wait), (None, Duration::from_secs(5)));
        for bad in [
            vec!["rh-server", "--drain-max-secs", "x"],
            vec!["rh-server", "--drain-max-secs", "-1"],
            vec!["rh-server", "--drain-write-wait-secs", "0"],
            vec!["rh-server", "--drain-max-secs"],
            vec!["rh-server", "--drain-max-secs", "86401"],
        ] {
            assert!(drain_settings(&args(&bad)).is_err(), "{bad:?}");
        }
        assert_eq!(
            db_connect_budget(&args(&["rh-server"])).unwrap(),
            Duration::from_secs(60)
        );
        assert_eq!(
            db_connect_budget(&args(&["rh-server", "--db-connect-timeout-secs", "0"])).unwrap(),
            Duration::ZERO
        );
        assert!(
            db_connect_budget(&args(&["rh-server", "--db-connect-timeout-secs", "abc"])).is_err()
        );
        assert!(
            db_connect_budget(&args(&["rh-server", "--db-connect-timeout-secs", "3601"])).is_err()
        );
    }

    #[tokio::test(start_paused = true)]
    async fn the_connect_retry_backs_off_then_succeeds_or_gives_up_within_its_budget() {
        let (ms, no_show) = (Duration::from_millis, |e: &String| e.clone());
        let not_fatal = |_: &String| false;
        // Two failures, then success: backoff 100, 200.
        let t0 = tokio::time::Instant::now();
        let tries = std::cell::Cell::new(0u32);
        let got = retry_with_backoff(
            Duration::from_secs(60),
            ms(100),
            ms(800),
            not_fatal,
            no_show,
            |n| {
                tries.set(n);
                async move {
                    if n < 3 {
                        Err(format!("down {n}"))
                    } else {
                        Ok(n)
                    }
                }
            },
        )
        .await;
        assert_eq!(got, Ok(3));
        assert_eq!(t0.elapsed(), ms(300));
        // Never reachable: stops when the budget is spent, with the last error, and does not overshoot it.
        let t0 = tokio::time::Instant::now();
        let got: Result<(), String> = retry_with_backoff(
            Duration::from_secs(2),
            ms(500),
            ms(1000),
            not_fatal,
            no_show,
            |n| async move { Err(format!("down {n}")) },
        )
        .await;
        assert!(got.unwrap_err().starts_with("down "));
        assert_eq!(t0.elapsed(), Duration::from_secs(2));
        // Budget zero is one attempt; a fatal error is never retried.
        let tries = std::cell::Cell::new(0u32);
        let got: Result<(), String> =
            retry_with_backoff(Duration::ZERO, ms(100), ms(100), not_fatal, no_show, |n| {
                tries.set(n);
                async move { Err("x".to_string()) }
            })
            .await;
        assert!(got.is_err() && tries.get() == 1);
        let tries = std::cell::Cell::new(0u32);
        let got: Result<(), String> = retry_with_backoff(
            Duration::from_secs(60),
            ms(100),
            ms(100),
            |_| true,
            no_show,
            |n| {
                tries.set(n);
                async move { Err("schema".to_string()) }
            },
        )
        .await;
        assert!(got.is_err() && tries.get() == 1);
    }

    #[test]
    fn logged_database_errors_never_carry_the_connection_string_or_password() {
        let url = "postgres://rh_admin:s3cr3t-pw@db.internal:5432/roguehalla";
        let msg = format!("error connecting to {url} (user rh_admin, password s3cr3t-pw): refused");
        let out = redact_secrets(&msg, &[url]);
        for leak in ["s3cr3t-pw", "rh_admin", "db.internal", "postgres://"] {
            assert!(!out.contains(leak), "{leak} leaked: {out}");
        }
        assert_eq!(
            redact_secrets("connection refused", &[url]),
            "connection refused"
        );
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

    fn bind(s: &str) -> SocketAddr {
        s.parse().unwrap()
    }

    #[test]
    fn dev_auth_is_refused_on_a_public_listener_unless_explicitly_accepted() {
        let lo = bind("127.0.0.1:7777");
        let any = bind("0.0.0.0:7777");
        let v6 = bind("[::]:7777");
        // Local development and every test harness: loopback, no proxy header.
        let e = exposure_check(&args(&["rh-server"]), lo).unwrap();
        assert!(!e.public && e.warnings.is_empty());
        assert!(exposure_check(&args(&["rh-server", "--auth", "dev"]), bind("[::1]:1")).is_ok());
        for public in [any, v6, bind("10.0.0.5:7777")] {
            for dev in [vec!["rh-server"], vec!["rh-server", "--auth", "dev"]] {
                let err = exposure_check(&args(&dev), public).unwrap_err();
                assert!(err.contains("--insecure-dev-auth"), "{err}");
            }
        }
        // Behind a reverse proxy (forwarded-address header) a loopback bind is public too.
        assert!(exposure_check(
            &args(&["rh-server", "--client-ip-header", "x-forwarded-for"]),
            lo
        )
        .is_err());
        // Real credentials on a public bind are fine.
        for ok in [
            vec!["rh-server", "--database-url", "postgres://x"],
            vec!["rh-server", "--auth", "static:/etc/tokens"],
            vec![
                "rh-server",
                "--auth",
                "dev",
                "--database-url",
                "postgres://x",
            ],
        ] {
            let e = exposure_check(&args(&ok), any).unwrap();
            assert!(e.public && e.warnings.is_empty(), "{ok:?}");
        }
        let e = exposure_check(&args(&["rh-server", "--insecure-dev-auth"]), any).unwrap();
        assert!(e.warnings[0].starts_with("INSECURE"), "{:?}", e.warnings);
        for typo in ["--insecure-devauth", "--insecure", "--insecure-dev-auth=1"] {
            assert!(
                exposure_check(&args(&["rh-server", typo]), lo).is_err(),
                "{typo}"
            );
        }
        let unused = exposure_check(&args(&["rh-server", "--insecure-dev-auth"]), lo).unwrap();
        assert_eq!(
            unused.warnings.len(),
            1,
            "an unneeded --insecure flag is called out"
        );
    }

    #[test]
    fn self_signed_tls_is_refused_on_a_public_listener_and_tls_flags_must_pair() {
        let lo = bind("127.0.0.1:7443");
        let any = bind("0.0.0.0:7443");
        let db = ["--database-url", "postgres://x"];
        let with = |extra: &[&str]| {
            let mut v = vec!["rh-server"];
            v.extend_from_slice(&db);
            v.extend_from_slice(extra);
            args(&v)
        };
        assert!(exposure_check(&with(&["--self-signed"]), lo).is_ok());
        let err = exposure_check(&with(&["--self-signed"]), any).unwrap_err();
        assert!(err.contains("--insecure-self-signed"), "{err}");
        let e = exposure_check(&with(&["--self-signed", "--insecure-self-signed"]), any).unwrap();
        assert!(e.warnings[0].starts_with("INSECURE"));
        assert!(exposure_check(&with(&["--tls-cert", "c.pem", "--tls-key", "k.pem"]), any).is_ok());
        for bad in [
            vec!["--tls-cert", "c.pem"],
            vec!["--tls-key", "k.pem"],
            vec!["--tls-cert"],
            vec!["--self-signed", "--tls-cert", "c.pem", "--tls-key", "k.pem"],
        ] {
            assert!(exposure_check(&with(&bad), lo).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn edge_flags_default_and_ws_origins_follow_the_api_cors_origins() {
        let api = api_config(&args(&[
            "rh-server",
            "--api-cors-origins",
            "https://play.rougehalla.com",
            "--client-ip-header",
            "x-forwarded-for",
            "--trusted-proxies",
            "127.0.0.1",
        ]))
        .unwrap();
        let (cfg, limits, warnings) = edge_settings(&args(&["rh-server"]), &api, true).unwrap();
        assert_eq!(
            cfg.origins,
            OriginPolicy::Only(vec!["https://play.rougehalla.com".into()])
        );
        assert_eq!(cfg.client_ip_header.as_ref().unwrap(), "x-forwarded-for");
        assert_eq!(
            cfg.trusted_proxies,
            vec!["127.0.0.1".parse::<std::net::IpAddr>().unwrap()]
        );
        assert_eq!(cfg.max_per_ip, rh_server::edge::DEFAULT_WS_MAX_PER_IP);
        assert_eq!(cfg.max_pending, rh_server::edge::DEFAULT_WS_MAX_PENDING);
        assert_eq!(cfg.auth_fails_per_minute, 10);
        assert_eq!(cfg.auth_fails_per_minute_all, 0);
        assert_eq!(limits.header_read_timeout, Duration::from_secs(10));
        assert!(warnings.is_empty());

        let (cfg, limits, _) = edge_settings(
            &args(&[
                "rh-server",
                "--ws-origins",
                "https://a.example,https://b.example/",
                "--ws-max-per-ip",
                "0",
                "--ws-connect-burst",
                "5",
                "--ws-connect-per-second",
                "1",
                "--ws-max-pending",
                "32",
                "--ws-auth-fails-per-minute",
                "3",
                "--ws-auth-fails-per-minute-all",
                "100",
                "--http-header-timeout-secs",
                "4",
            ]),
            &api,
            true,
        )
        .unwrap();
        assert_eq!(
            cfg.origins,
            OriginPolicy::Only(vec!["https://a.example".into(), "https://b.example".into()])
        );
        assert_eq!(
            (
                cfg.max_per_ip,
                cfg.connect_burst,
                cfg.connect_per_second,
                cfg.max_pending
            ),
            (0, 5.0, 1.0, 32)
        );
        assert_eq!(
            (cfg.auth_fails_per_minute, cfg.auth_fails_per_minute_all),
            (3, 100)
        );
        assert_eq!(limits.header_read_timeout, Duration::from_secs(4));
    }

    #[test]
    fn an_empty_origin_list_is_permissive_only_when_not_publicly_exposed() {
        let api = ApiConfig::default();
        let (local, _, w) = edge_settings(&args(&["rh-server"]), &api, false).unwrap();
        assert_eq!(local.origins, OriginPolicy::Any);
        assert!(w.is_empty());
        let (public, _, w) = edge_settings(&args(&["rh-server"]), &api, true).unwrap();
        assert_eq!(public.origins, OriginPolicy::Only(vec![]));
        assert_eq!(w.len(), 1);
        let (star, _, w) =
            edge_settings(&args(&["rh-server", "--ws-origins", "*"]), &api, true).unwrap();
        assert_eq!(star.origins, OriginPolicy::Any);
        assert_eq!(w.len(), 1, "a public '*' is called out");
    }

    #[test]
    fn edge_flags_refuse_typos_and_bad_values() {
        let api = ApiConfig::default();
        for bad in [
            vec!["rh-server", "--ws-max-per-address", "4"],
            vec!["rh-server", "--ws-origin", "https://a.example"],
            vec!["rh-server", "--http-header-timeout", "4"],
            vec!["rh-server", "--ws-max-per-ip", "-1"],
            vec!["rh-server", "--ws-max-pending", "x"],
            vec!["rh-server", "--ws-origins"],
            vec!["rh-server", "--ws-origins", "--bind"],
            vec!["rh-server", "--http-header-timeout-secs", "0"],
            vec!["rh-server", "--http-header-timeout-secs", "301"],
        ] {
            assert!(edge_settings(&args(&bad), &api, false).is_err(), "{bad:?}");
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

    /// Integration of fix/server-security and fix/server-resilience with the integration branch's runtime flags (map pool,
    /// signature landmarks, lobby timing, hitboxes, bot learning; taken from integration/launch-fixes 3f5e68c8 with
    /// fix/map-variety's `--generate-maps` replaced by `--map-pool`): each flag family's typo guard (`--insecure*`,
    /// `--ws-*`/`--http-*`, `--require*`/`--admit*`/`--control*`, `--runtime*`) must accept every other family's real flags in
    /// one command line.
    #[test]
    fn every_flag_parser_accepts_the_other_branches_flags_together() {
        let token_file =
            std::env::temp_dir().join(format!("rh-int-flags-token-{}", std::process::id()));
        std::fs::write(&token_file, "int-token\n").unwrap();
        let common = [
            "rh-server",
            "--bind",
            "127.0.0.1:7777",
            "--runtime",
            "source-arena",
            "--map",
            "map.json",
            "--map-pool",
            "--signature-landmarks",
            "--lobby-timing",
            "matchmaking",
            "--hitboxes",
            "archetypes",
            "--bot-learning",
            "single-writer",
            "--client-ip-header",
            "x-forwarded-for",
            "--trusted-proxies",
            "127.0.0.1",
            "--api-cors-origins",
            "https://play.example",
            "--ws-origins",
            "https://play.example",
            "--ws-max-per-ip",
            "16",
            "--ws-connect-burst",
            "20",
            "--ws-connect-per-second",
            "2",
            "--ws-max-pending",
            "256",
            "--ws-auth-fails-per-minute",
            "10",
            "--ws-auth-fails-per-minute-all",
            "0",
            "--http-header-timeout-secs",
            "10",
            "--insecure-dev-auth",
            "--db-connect-timeout-secs",
            "60",
            "--drain-max-secs",
            "55",
            "--drain-write-wait-secs",
            "20",
            "--control",
            "127.0.0.1:7778",
        ];
        let token = token_file.to_str().unwrap();
        for tail in [
            vec!["--control-insecure-loopback"],
            vec!["--control-token-file", token],
        ] {
            let a = args(&[&common[..], &tail[..]].concat());
            let bind: SocketAddr = "127.0.0.1:7777".parse().unwrap();
            let exposure = exposure_check(&a, bind).unwrap();
            assert!(
                exposure.public,
                "--client-ip-header makes the listener public"
            );
            hosted_settings(&a).unwrap();
            let d = drain_settings(&a).unwrap();
            assert_eq!(d.max, Some(Duration::from_secs(55)));
            assert_eq!(db_connect_budget(&a).unwrap(), Duration::from_secs(60));
            let api = api_config(&a).unwrap();
            edge_settings(&a, &api, exposure.public).unwrap();
            lease_policy(&a).unwrap();
            let rt = rh_server::runtime::Settings::from_args(&a)
                .unwrap()
                .unwrap();
            assert_eq!(rt.profile, rh_server::runtime::Profile::SourceArena);
            assert!(rt.map_pool && rt.signature_landmarks);
            assert_eq!(
                rh_server::bot_learning::LearningMode::from_args(&a).unwrap(),
                rh_server::bot_learning::LearningMode::SingleWriter
            );
        }
        let _ = std::fs::remove_file(&token_file);
    }
}
