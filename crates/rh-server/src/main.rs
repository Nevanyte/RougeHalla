//! rh-server: the live authoritative match server.
//!
//!   cargo run --release -p rh-server -- --bind 127.0.0.1:7777 [--self-signed | --tls-cert cert.pem --tls-key key.pem]
//!       [--runtime core|source-arena|training] (one configured profile per endpoint; source-arena requires --map)
//!       [--hitboxes legacy|archetypes] (ADR0024; default legacy on every path; archetypes opts in to the measured boxes)
//!       [--tick-ms 50|25] (ADR 0029; else RH_TICK_MS, else 25 since P-TICK-6: every room's step, its Welcome rate and its pacer)
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

use database::durable;
use first_playable::{
    first_playable_arena, first_playable_settings, service_deadline, FIRST_PLAYABLE_GRACE,
    FIRST_PLAYABLE_LIFETIME,
};
use flags::{arg, wish_full_enabled};
use rh_server::api::AccountApi;
use rh_server::director::{Director, DirectorConfig};
use rh_server::hosting::Lifecycle;
use rh_server::persist::{Auth, Persistence};
#[cfg(feature = "postgres")]
use settings::spool_settings;
use settings::{
    api_config, drain_settings, edge_settings, exposure_check, hosted_settings, lease_policy,
    HTTP_SHUTDOWN_GRACE,
};
use std::net::SocketAddr;
use std::sync::Arc;

#[path = "startup/database.rs"]
mod database;
#[path = "startup/first_playable.rs"]
mod first_playable;
#[path = "startup/flags.rs"]
mod flags;
#[path = "startup/settings.rs"]
mod settings;

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
    // P-TICK-5: the room step (`--tick-ms 50|25`, else `RH_TICK_MS`, else 25 since P-TICK-6) for every profile this process hosts.
    let tick_ms = rh_server::runtime::tick_ms_setting(&args, |key| std::env::var(key).ok())
        .unwrap_or_else(|e| {
            eprintln!("[server] invalid tick settings: {e}");
            std::process::exit(2);
        });
    let mut sim = runtime.as_ref().map_or_else(
        || rh_sim::SimConfig {
            hitboxes: core_hitboxes,
            mob_spacing: Default::default(),
            regen_in_combat: rh_sim::RegenInCombat::Legacy,
            camp_buffs: rh_sim::CampBuffRule::Legacy,
            frost_wish: rh_sim::FrostWish::Freeze,
            augments: rh_sim::AugmentRule::Legacy,
            elites: rh_sim::EliteRule::Legacy,
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
            tick_ms,
        },
        |runtime| runtime.sim(),
    );
    sim.tick_ms = tick_ms;
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
        let maker = runtime
            .as_ref()
            .map(rh_server::runtime::Settings::styled_maker)
            .unwrap_or_default();
        let coliseum = if maker.grand_coliseum {
            "grand"
        } else {
            "legacy"
        };
        cfg.map_pool = Some(std::sync::Arc::new(rh_server::map_pool::MapPool::start(
            configured, maker,
        )));
        eprintln!(
            "[server] map pool on: each room takes its own certified map (target {}, {coliseum} coliseum)",
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
#[path = "startup/tests.rs"]
mod tests;
