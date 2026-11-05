//! Runs one scenario against a server: ramp, steady window, optional shutdown trigger, sampling of the server process, and
//! the aggregation of everything the clients measured into one JSON report.

use crate::player::{self, Player, Role};
use crate::report;
use crate::scenario::{Scenario, ShutdownMode};
use crate::script::Rng;
use crate::server::{self, Running, ServerSpec};
use crate::shared::{Shared, Target};
use crate::stats::cpu_cores;
use crate::sys::{self, get_json, Creds};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering::Relaxed};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::task::JoinSet;

#[derive(Clone, Debug, Default)]
pub struct RunOpts {
    pub label: String,
    pub out_dir: PathBuf,
    pub hardware_label: Option<String>,
    pub emulated: bool,
    pub keep_creds: bool,
    /// The command line, recorded in the report.
    pub command: String,
}

/// TLS connector for `wss://`: the webpki roots (a real certificate), or, for a self-signed local server and only when asked,
/// a verifier that accepts any certificate.
pub fn connector(sc: &Scenario) -> Option<tokio_tungstenite::Connector> {
    if !sc.tls {
        return Some(tokio_tungstenite::Connector::Plain);
    }
    if !sc.insecure {
        return None;
    }
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let cfg = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .expect("protocol versions")
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AcceptAny(provider)))
        .with_no_client_auth();
    Some(tokio_tungstenite::Connector::Rustls(Arc::new(cfg)))
}

#[derive(Debug)]
struct AcceptAny(Arc<rustls::crypto::CryptoProvider>);

impl rustls::client::danger::ServerCertVerifier for AcceptAny {
    fn verify_server_cert(
        &self,
        _: &rustls::pki_types::CertificateDer<'_>,
        _: &[rustls::pki_types::CertificateDer<'_>],
        _: &rustls::pki_types::ServerName<'_>,
        _: &[u8],
        _: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        _: &[u8],
        _: &rustls::pki_types::CertificateDer<'_>,
        _: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }
    fn verify_tls13_signature(
        &self,
        _: &[u8],
        _: &rustls::pki_types::CertificateDer<'_>,
        _: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }
    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

/// Roles for `n` main players: a deterministic pseudo-random draw per player index from the scenario seed.
pub fn roles(sc: &Scenario) -> Vec<Role> {
    (0..sc.total_players())
        .map(|i| {
            let mut r = Rng::new(sc.seed.wrapping_mul(0x9E37).wrapping_add(i as u64));
            Role::Normal {
                reconnector: r.chance(sc.reconnect_fraction),
                slow: r.chance(sc.slow_fraction),
            }
        })
        .collect()
}

/// Seconds after the run starts at which player `i` (0-based, numbered match by match) first connects.
pub fn start_offset(sc: &Scenario, i: usize) -> f64 {
    let (m, k) = (i / sc.players_per_match, i % sc.players_per_match);
    m as f64 / sc.ramp_per_sec + (k as u64 * sc.join_stagger_ms) as f64 / 1000.0
}

/// Fixed thresholds for calling a level degraded (documented in docs/hosting/LOAD_BASELINE.md; a harness choice, not a
/// server contract).
pub const STEP_P99_US_LIMIT: u64 = 25_000;
pub const LATENESS_P99_US_LIMIT: u64 = 25_000;
pub const CLIENT_INTERVAL_P99_MS_LIMIT: u64 = 100;
pub const MISSED_TICK_FRACTION_LIMIT: f64 = 0.005;

/// The reasons a level counts as degraded, from the final server metrics and the client-side tick statistics. Empty = healthy.
pub fn degradation(
    server_metrics: &Value,
    client_p99_ms: u64,
    ticks_missed: u64,
    snapshots: u64,
) -> Vec<String> {
    let mut why = Vec::new();
    let u = |p: &str| server_metrics.pointer(p).and_then(Value::as_u64);
    if let Some(d) = u("/droppedSteps") {
        if d > 0 {
            why.push(format!("server dropped {d} steps (pacer backlog)"));
        }
    }
    if let Some(p) = u("/stepUs/p99") {
        if p > STEP_P99_US_LIMIT {
            why.push(format!(
                "step p99 {p} us over {STEP_P99_US_LIMIT} us (half a tick)"
            ));
        }
    }
    if let Some(p) = u("/latenessUs/p99") {
        if p > LATENESS_P99_US_LIMIT {
            why.push(format!(
                "wake lateness p99 {p} us over {LATENESS_P99_US_LIMIT} us"
            ));
        }
    }
    if client_p99_ms > CLIENT_INTERVAL_P99_MS_LIMIT {
        why.push(format!("client snapshot interval p99 {client_p99_ms} ms over {CLIENT_INTERVAL_P99_MS_LIMIT} ms (two ticks)"));
    }
    if snapshots > 0 && ticks_missed as f64 / snapshots as f64 > MISSED_TICK_FRACTION_LIMIT {
        why.push(format!(
            "{ticks_missed} ticks missed over {snapshots} snapshots"
        ));
    }
    why
}

/// Judge missed ticks against intervals from the same steady measurement window.
fn measured_degradation(server_metrics: &Value, sh: &Shared) -> Vec<String> {
    degradation(
        server_metrics,
        sh.snapshot_interval_ms.quantile(0.99),
        sh.c.ticks_missed.load(Relaxed),
        sh.snapshot_interval_ms.count(),
    )
}

struct Sampler {
    series: Arc<Mutex<Vec<Value>>>,
    stop: Arc<AtomicBool>,
    handle: tokio::task::JoinHandle<()>,
}

/// Samples every `sample_secs`: server and harness CPU/RSS (via `ps`), the control health document (rooms, state, server
/// metrics) and the live client counters.
fn start_sampler(
    sh: Arc<Shared>,
    pid: Option<u32>,
    control: Option<std::net::SocketAddr>,
    public_info: Option<std::net::SocketAddr>,
) -> Sampler {
    let series = Arc::new(Mutex::new(Vec::new()));
    let stop = Arc::new(AtomicBool::new(false));
    let (s2, st2) = (series.clone(), stop.clone());
    let handle = tokio::spawn(async move {
        let me = std::process::id();
        let mut prev_srv: Option<(f64, Instant)> = None;
        let mut prev_me: Option<(f64, Instant)> = None;
        let period = Duration::from_secs_f64(sh.sc.sample_secs);
        while !st2.load(Relaxed) {
            let now = Instant::now();
            let srv = match pid {
                Some(p) => tokio::task::spawn_blocking(move || sys::sample_process(p))
                    .await
                    .ok()
                    .flatten(),
                None => None,
            };
            let meas = tokio::task::spawn_blocking(move || sys::sample_process(me))
                .await
                .ok()
                .flatten();
            let rate =
                |prev: &mut Option<(f64, Instant)>, cur: Option<(f64, u64)>| -> Option<f64> {
                    let (cpu, _) = cur?;
                    let r = prev.and_then(|(c0, t0)| cpu_cores(c0, cpu, (now - t0).as_secs_f64()));
                    *prev = Some((cpu, now));
                    r
                };
            let srv_cpu = rate(&mut prev_srv, srv);
            let me_cpu = rate(&mut prev_me, meas);
            let health = match control {
                Some(c) => get_json(c, "/control/health").await,
                None => None,
            };
            let info = match public_info {
                Some(a) => get_json(a, "/info").await.map(|(_, v)| v),
                None => None,
            };
            let m = health
                .as_ref()
                .map(|(_, v)| v["metrics"].clone())
                .unwrap_or(Value::Null);
            let phase = if sh.triggered() {
                "shutdown"
            } else if sh.measuring.load(Relaxed) {
                "steady"
            } else {
                "ramp"
            };
            let round = |x: Option<f64>| x.map(|v| (v * 1000.0).round() / 1000.0);
            let point = json!({
                "tSecs": (sh.start.elapsed().as_secs_f64() * 100.0).round() / 100.0,
                "phase": phase,
                "serverCpuCores": round(srv_cpu),
                "serverRssMb": srv.map(|(_, r)| (r as f64 / 1048576.0 * 10.0).round() / 10.0),
                "harnessCpuCores": round(me_cpu),
                "harnessRssMb": meas.map(|(_, r)| (r as f64 / 1048576.0 * 10.0).round() / 10.0),
                "state": health.as_ref().map(|(_, v)| v["state"].clone()),
                "rooms": health.as_ref().map(|(_, v)| v["rooms"].clone()),
                "serverPlayers": info.as_ref().map(|v| v["players"].clone()),
                "lobbies": info.as_ref().map(|v| v["lobbies"].clone()),
                "clientsConnected": sh.c.connected_now.load(Relaxed),
                "steps": m["steps"], "droppedSteps": m["droppedSteps"], "serverBytesOut": m["bytesOut"],
                "stepUsP50": m["stepUs"]["p50"], "stepUsP99": m["stepUs"]["p99"], "stepUsMax": m["stepUs"]["max"],
                "publishUsP99": m["publishUs"]["p99"],
                "latenessUsP99": m["latenessUs"]["p99"], "latenessUsMax": m["latenessUs"]["max"],
                "clientSnapshots": sh.c.snapshots.load(Relaxed),
                "clientBytesIn": sh.c.bytes_in.load(Relaxed),
                "rejectedTotal": sh.c.rejected_total.load(Relaxed),
            });
            s2.lock().expect("series").push(point);
            tokio::time::sleep(period).await;
        }
    });
    Sampler {
        series,
        stop,
        handle,
    }
}

fn stage_points<'a>(series: &'a [Value], phase: &str) -> Vec<&'a Value> {
    series.iter().filter(|p| p["phase"] == phase).collect()
}

fn col(points: &[&Value], key: &str) -> Vec<f64> {
    points.iter().filter_map(|p| p[key].as_f64()).collect()
}

fn mean(v: &[f64]) -> Option<f64> {
    (!v.is_empty()).then(|| v.iter().sum::<f64>() / v.len() as f64)
}

fn r3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

/// One scenario, end to end. Returns the full report (also written under `opts.out_dir`).
pub async fn run_one(sc: &Scenario, spec: &ServerSpec, opts: &RunOpts) -> Result<Value, String> {
    sc.validate()?;
    std::fs::create_dir_all(&opts.out_dir).map_err(|e| format!("out dir: {e}"))?;
    let total = sc.total_players();
    // Main players, churn clients, one probe identity.
    let creds = Creds::generate(total + sc.churn_clients + 1);
    let mut running: Running = server::start(sc, spec, &creds, &opts.out_dir, &opts.label).await?;
    let result = run_against(sc, spec, opts, &creds, &mut running).await;
    // Whatever happened, leave nothing behind: auth file removed, server stopped.
    if let Some(p) = &running.auth_file {
        if !opts.keep_creds {
            let _ = std::fs::remove_file(p);
        }
    }
    if let Some(child) = running.child.as_mut() {
        if child.try_wait().ok().flatten().is_none() {
            if let Some(pid) = running.pid {
                server::sigterm(pid);
            }
            if tokio::time::timeout(Duration::from_secs(30), child.wait())
                .await
                .is_err()
            {
                let _ = child.kill().await;
            }
        }
    }
    result
}

pub async fn run_against(
    sc: &Scenario,
    spec: &ServerSpec,
    opts: &RunOpts,
    creds: &Creds,
    running: &mut Running,
) -> Result<Value, String> {
    sc.validate()?;
    if running
        .pid
        .is_some_and(|pid| pid == 0 || pid > i32::MAX as u32)
    {
        return Err("pid must name one process (1..=2147483647)".into());
    }
    let total = sc.total_players();
    if creds.entries.len() < total + sc.churn_clients + 1 {
        return Err("not enough credentials for main, churn and probe clients".into());
    }
    let scheme = if sc.tls { "wss" } else { "ws" };
    let target = Target {
        ws_url: format!("{scheme}://{}/ws", running.public),
        host_port: running.public.to_string(),
        connector: connector(sc),
    };
    let sh = Shared::new(sc.clone(), target, rh_sim::content::content_hash());
    let info_addr = (!sc.tls).then_some(running.public);
    let sampler = start_sampler(sh.clone(), running.pid, running.control, info_addr);
    let cpu_first = running.pid.and_then(sys::sample_process);

    // Players.
    let roles = roles(sc);
    let mut tasks: JoinSet<()> = JoinSet::new();
    let t0 = tokio::time::Instant::now();
    let mut last_start = 0.0f64;
    for (i, role) in roles.iter().enumerate() {
        let (name, token) = creds.entries[i].clone();
        let off = start_offset(sc, i);
        last_start = last_start.max(off);
        let p = Player {
            idx: i,
            name,
            ticket: token.into_bytes(),
            role: *role,
            seed: i as u64 + 1,
        };
        tasks.spawn(player::run_player(
            sh.clone(),
            p,
            t0 + Duration::from_secs_f64(off),
        ));
    }
    let settle = 3.0;
    let steady_start = last_start + settle;
    for j in 0..sc.churn_clients {
        let (name, token) = creds.entries[total + j].clone();
        let p = Player {
            idx: total + j,
            name,
            ticket: token.into_bytes(),
            role: Role::Churn,
            seed: 10_000 + j as u64,
        };
        let off = steady_start + (j as f64 * 0.37) % 3.0;
        tasks.spawn(player::run_churn(
            sh.clone(),
            p,
            t0 + Duration::from_secs_f64(off),
        ));
    }
    let probe_player = {
        let (name, token) = creds.entries[total + sc.churn_clients].clone();
        Player {
            idx: usize::MAX,
            name,
            ticket: token.into_bytes(),
            role: Role::Probe,
            seed: 99,
        }
    };

    tokio::time::sleep_until(t0 + Duration::from_secs_f64(steady_start)).await;
    sh.measuring.store(true, Relaxed);
    let steady_t0 = Instant::now();
    let run_end = steady_t0 + Duration::from_secs_f64(sc.duration_secs);
    let mut shutdown_report = Value::Null;

    if let Some(plan) = sc.shutdown {
        tokio::time::sleep_until(tokio::time::Instant::from_std(
            steady_t0 + Duration::from_secs_f64(plan.at_secs),
        ))
        .await;
        shutdown_report =
            shutdown_phase(&sh, running, plan.mode, sc, &probe_player, &mut tasks).await?;
    } else {
        tokio::time::sleep_until(tokio::time::Instant::from_std(run_end)).await;
    }
    let steady_secs = steady_t0.elapsed().as_secs_f64();

    // End of run: everyone Leaves and exits.
    sh.measuring.store(false, Relaxed);
    sh.stop.store(true, Relaxed);
    let join_deadline = Instant::now() + Duration::from_secs(20);
    while !tasks.is_empty() {
        let left = join_deadline.saturating_duration_since(Instant::now());
        if tokio::time::timeout(left, tasks.join_next()).await.is_err() {
            tasks.abort_all();
            break;
        }
    }
    let total_secs = sh.start.elapsed().as_secs_f64();
    let cpu_last = running.pid.and_then(sys::sample_process);
    // One more sample after the clients left, then stop sampling.
    tokio::time::sleep(Duration::from_secs_f64(sc.sample_secs.min(1.5))).await;
    sampler.stop.store(true, Relaxed);
    let _ = tokio::time::timeout(Duration::from_secs(5), sampler.handle).await;
    let series = sampler.series.lock().expect("series").clone();
    let final_metrics = match running.control {
        Some(c) => get_json(c, "/control/health")
            .await
            .map(|(_, v)| v["metrics"].clone())
            .unwrap_or(Value::Null),
        None => Value::Null,
    };
    let final_info = match info_addr {
        Some(a) => get_json(a, "/info").await.map(|(_, v)| v),
        None => None,
    };

    // Aggregation.
    let steady = stage_points(&series, "steady");
    let all: Vec<&Value> = series.iter().collect();
    let rooms_steady = col(&steady, "rooms");
    let cpu_steady = col(&steady, "serverCpuCores");
    let rss_all = col(&all, "serverRssMb");
    let lists = sh.lists.lock().expect("lists");
    let c = &sh.c;
    let n = |a: &std::sync::atomic::AtomicU64| a.load(Relaxed);
    let whole_run_cpu = match (cpu_first, cpu_last) {
        (Some((a, _)), Some((b, _))) => cpu_cores(a, b, total_secs),
        _ => None,
    };
    let bw: Vec<(f64, f64)> = lists
        .per_client
        .iter()
        .filter(|(_, _, s)| *s >= 5.0)
        .map(|(i, o, s)| (*i as f64 / s, *o as f64 / s))
        .collect();
    let bw_in: Vec<f64> = bw.iter().map(|b| b.0).collect();
    let bw_out: Vec<f64> = bw.iter().map(|b| b.1).collect();
    let snaps = n(&c.snapshots);
    let degraded = measured_degradation(&final_metrics, &sh);
    let welcome_gap = |v: &Vec<f64>| crate::stats::summary_json(v.clone());
    let reconnect_attempts = n(&c.reconnect_attempts);
    let admitted = n(&c.players_admitted);
    let git = sys::git_revision();
    let profile = spec
        .build_profile
        .clone()
        .or_else(|| {
            spec.bin
                .as_ref()
                .map(|b| server::guess_profile(b).to_string())
        })
        .unwrap_or_else(|| "unknown (attached)".into());
    let json_path = opts.out_dir.join(format!("{}.json", opts.label));
    let report = json!({
        "schema": "rh-load/1",
        "label": opts.label,
        "label_note": "baseline slice only, not full-game capacity",
        "meta": {
            "gitRevision": git,
            "unixTime": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
            "host": sys::host_meta(opts.hardware_label.as_deref(), opts.emulated),
            "server": {
                "binary": spec.bin.as_ref().map(|b| b.display().to_string()),
                "buildProfile": profile,
                "attached": spec.attach_public.map(|a| a.to_string()),
                "pid": running.pid,
                "argv": running.argv,
                "protocol": rh_protocol::PROTOCOL_VERSION,
                "contentHash": format!("{:016x}", rh_sim::content::content_hash()),
                "serverLog": running.log_path.as_ref().map(|p| p.display().to_string()),
            },
            "transport": if sc.tls { if sc.insecure { "wss (self-signed, certificate not verified)" } else { "wss (verified)" } } else { "ws (plain, loopback)" },
            "executionNote": "client harness and server share this host; harness CPU is reported separately",
            "command": opts.command,
            "rawOutput": json_path.display().to_string(),
        },
        "scenario": sc.json(),
        "timing": {
            "rampSecs": r3(last_start), "settleSecs": settle, "steadySecs": r3(steady_secs), "totalSecs": r3(total_secs),
        },
        "coldStart": { "controlHealthMs": running.cold_control_ms.map(r3), "publicPortMs": running.cold_public_ms.map(r3),
                        "note": "process spawn to GET /control/health = 200, and to the public port accepting TCP" },
        "capacity": {
            "roomsPeak": col(&all, "rooms").into_iter().fold(0.0, f64::max),
            "roomsSteadyMean": mean(&rooms_steady).map(r3),
            "roomsSteadyMin": rooms_steady.iter().cloned().fold(f64::INFINITY, f64::min).is_finite().then(|| rooms_steady.iter().cloned().fold(f64::INFINITY, f64::min)),
            "serverPlayersPeak": col(&all, "serverPlayers").into_iter().fold(0.0, f64::max),
            "playersWanted": total, "playersAdmittedAtLeastOnce": admitted, "playersNeverAdmitted": (total as u64).saturating_sub(admitted),
            "maxRooms": sc.max_rooms,
        },
        "server": {
            "cpuCoresSteadyMean": mean(&cpu_steady).map(r3),
            "cpuCoresSteadyMax": cpu_steady.iter().cloned().fold(None, |a: Option<f64>, b| Some(a.map_or(b, |x| x.max(b)))).map(r3),
            "cpuCoresWholeRunMean": whole_run_cpu.map(r3),
            "cpuMethod": "ps -o cputime= delta over wall time (1.0 = one busy core); 10 ms resolution on macOS",
            "rssMbPeak": rss_all.iter().cloned().fold(None, |a: Option<f64>, b| Some(a.map_or(b, |x| x.max(b)))),
            "rssMbMean": mean(&rss_all).map(r3),
            "metricsFinal": final_metrics,
            "metricsNote": "cumulative since server start (a fresh server per run); stepUs is one room's simulation step, per step; quantiles are histogram bucket upper bounds (<= 25% above true); there is no server-side p95",
            "info": final_info,
        },
        "clientTick": {
            "snapshotIntervalMs": sh.snapshot_interval_ms.json(),
            "lateSnapshots100ms": n(&c.late_snapshots_100ms), "lateSnapshots200ms": n(&c.late_snapshots_200ms), "lateSnapshots500ms": n(&c.late_snapshots_500ms),
            "ticksMissed": n(&c.ticks_missed),
            "measuredSnapshotIntervals": sh.snapshot_interval_ms.count(),
            "note": "measured by the clients during the steady window; includes harness scheduling noise (the harness shares the host)",
        },
        "admission": {
            "connectMs": welcome_gap(&lists.connect_ms),
            "helloToWelcomeMs": welcome_gap(&lists.hello_to_welcome_ms),
            "welcomeToFirstSnapshotMs": welcome_gap(&lists.welcome_to_first_snapshot_ms),
            "resumeHelloToWelcomeMs": welcome_gap(&lists.resume_hello_to_welcome_ms),
            "welcomesFresh": n(&c.welcomes_fresh), "welcomesResume": n(&c.welcomes_resume),
            "refusalsByReason": lists.refusals,
            "connectErrors": n(&c.connect_errors),
        },
        "bandwidth": {
            "perClientBytesPerSecIn": crate::stats::summary_json(bw_in),
            "perClientBytesPerSecOut": crate::stats::summary_json(bw_out),
            "totalBytesIn": n(&c.bytes_in), "totalBytesOut": n(&c.bytes_out),
            "note": "WebSocket payload bytes (protocol frames); no WS/TCP/TLS framing; sessions of at least 5 s",
        },
        "reconnect": {
            "attempts": reconnect_attempts, "ok": n(&c.reconnect_ok), "failed": n(&c.reconnect_failed),
            "successRate": (reconnect_attempts > 0).then(|| r3(n(&c.reconnect_ok) as f64 / reconnect_attempts as f64)),
            "failuresByReason": lists.reconnect_failures,
        },
        "slowConsumers": { "started": n(&c.slow_started), "outcomes": lists.slow_outcomes },
        "churn": { "joins": n(&c.churn_joins), "leaves": n(&c.churn_leaves) },
        "play": {
            "results": n(&c.results), "inputsSent": n(&c.inputs_sent), "snapshots": snaps, "framesIn": n(&c.frames_in),
            "decodeErrors": n(&c.decode_errors), "sessionsEndedAbnormally": n(&c.sessions_ended_abnormally),
            "otherEvents": lists.errors,
        },
        "shutdown": shutdown_report,
        "verdict": { "degraded": !degraded.is_empty(), "reasons": degraded,
                      "thresholds": { "stepUsP99": STEP_P99_US_LIMIT, "latenessUsP99": LATENESS_P99_US_LIMIT,
                                       "clientIntervalMsP99": CLIENT_INTERVAL_P99_MS_LIMIT, "missedTickFraction": MISSED_TICK_FRACTION_LIMIT } },
        "series": series,
    });
    drop(lists);
    report::write_report(&opts.out_dir, &opts.label, &report)?;
    Ok(report)
}

/// The shutdown phase: trigger (SIGTERM or `POST /control/drain`), then probe admissions until the server is gone and
/// watch what the active clients experience.
async fn shutdown_phase(
    sh: &Arc<Shared>,
    running: &mut Running,
    mode: ShutdownMode,
    sc: &Scenario,
    probe_player: &Player,
    tasks: &mut JoinSet<()>,
) -> Result<Value, String> {
    let health = match running.control {
        Some(c) => get_json(c, "/control/health").await.map(|(_, v)| v),
        None => None,
    };
    let rooms_at_trigger = health.as_ref().and_then(|h| h["rooms"].as_u64());
    let trig = Instant::now();
    sh.trigger_ms
        .store(sh.start.elapsed().as_millis() as i64, Relaxed);
    let triggered_at_secs = sh.start.elapsed().as_secs_f64();
    let sent = match mode {
        ShutdownMode::Sigterm => running
            .pid
            .map(server::sigterm)
            .ok_or("--shutdown-mode sigterm needs a spawned server (or --pid)")?,
        ShutdownMode::Drain => {
            let c = running
                .control
                .ok_or("--shutdown-mode drain needs the control address")?;
            matches!(
                sys::http(c, "POST", "/control/drain", Duration::from_secs(10)).await,
                Ok((200, _))
            )
        }
    };
    let mut probes: Vec<Value> = Vec::new();
    let mut first_refusal_ms: Option<f64> = None;
    let mut exited_after: Option<f64> = None;
    let mut exit_status: Option<String> = None;
    let deadline = trig + Duration::from_secs_f64(sc.drain_wait_secs);
    let mut rooms_last: Option<u64> = rooms_at_trigger;
    loop {
        // Probe a fresh admission every ~500 ms while the server is up.
        let outcome = player::probe(sh, probe_player).await;
        let t = trig.elapsed().as_secs_f64();
        if outcome == "ServerDraining" && first_refusal_ms.is_none() {
            first_refusal_ms = Some(r3(t * 1000.0));
        }
        if probes.len() < 200 {
            probes.push(json!({"tSecs": r3(t), "outcome": outcome}));
        }
        if let Some(child) = running.child.as_mut() {
            if let Ok(Some(st)) = child.try_wait() {
                exited_after = Some(r3(trig.elapsed().as_secs_f64()));
                exit_status = Some(st.to_string());
                break;
            }
        } else if outcome.starts_with("tcp connect") {
            exited_after = Some(r3(trig.elapsed().as_secs_f64()));
            break;
        }
        if let Some(c) = running.control {
            if let Some((_, v)) = get_json(c, "/control/health").await {
                rooms_last = v["rooms"].as_u64().or(rooms_last);
            }
        }
        if Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    // Let finished clients settle before the caller stops the rest.
    let grace = Instant::now() + Duration::from_secs(5);
    while Instant::now() < grace && !tasks.is_empty() {
        if tokio::time::timeout(Duration::from_millis(250), tasks.join_next())
            .await
            .is_err()
        {
            break;
        }
    }
    let c = &sh.c;
    let n = |a: &std::sync::atomic::AtomicU64| a.load(Relaxed);
    let lists = sh.lists.lock().expect("lists");
    Ok(json!({
        "mode": match mode { ShutdownMode::Sigterm => "sigterm", ShutdownMode::Drain => "drain" },
        "triggerSent": sent,
        "triggeredAtSecs": r3(triggered_at_secs),
        "roomsAtTrigger": rooms_at_trigger,
        "roomsLastSeen": rooms_last,
        "serverExitedAfterSecs": exited_after,
        "serverExitStatus": exit_status,
        "drainWaitSecs": sc.drain_wait_secs,
        "timedOutWaitingForExit": exited_after.is_none(),
        "firstAdmissionRefusalMs": first_refusal_ms,
        "probeCount": probes.len(),
        "probeOutcomes": probes,
        "freshWelcomesAfterTrigger": n(&c.post_fresh_welcomes),
        "resumeWelcomesAfterTrigger": n(&c.post_resume_welcomes),
        "resultsAfterTrigger": n(&c.post_results),
        "abnormalSessionEndsAfterTrigger": n(&c.post_abnormal_ends),
        "refusalsAfterTrigger": lists.post_refusals,
        "note": "a fresh Welcome after the trigger would be an admission the draining server should have refused; resume Welcomes are allowed (held seats)",
    }))
}

/// Where reports go by default.
pub fn default_out_dir() -> PathBuf {
    Path::new("target").join("load")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ramp_snapshots_cannot_dilute_steady_missed_tick_verdict() {
        let sh = Shared::new(
            Scenario::default(),
            Target {
                ws_url: "ws://127.0.0.1:1/ws".into(),
                host_port: "127.0.0.1:1".into(),
                connector: None,
            },
            0,
        );
        sh.c.snapshots.store(10_000, Relaxed); // 9,000 ramp snapshots, 1,000 measured intervals.
        sh.c.ticks_missed.store(10, Relaxed);
        for _ in 0..1_000 {
            sh.snapshot_interval_ms.record(50.0);
        }
        let reasons = measured_degradation(&Value::Null, &sh);
        assert_eq!(
            reasons.len(),
            1,
            "1% missed during steady is degraded even after a long ramp"
        );
        assert!(reasons[0].contains("10 ticks missed over 1000"));
    }

    #[test]
    fn start_offsets_ramp_matches_and_stagger_players() {
        let sc = Scenario {
            ramp_per_sec: 10.0,
            join_stagger_ms: 20,
            players_per_match: 8,
            ..Scenario::default()
        };
        assert_eq!(start_offset(&sc, 0), 0.0);
        assert!((start_offset(&sc, 1) - 0.02).abs() < 1e-9);
        assert!(
            (start_offset(&sc, 8) - 0.1).abs() < 1e-9,
            "second match starts 1/ramp later"
        );
        assert!((start_offset(&sc, 17) - (0.2 + 0.02)).abs() < 1e-9);
    }

    #[test]
    fn roles_follow_the_fractions_and_are_deterministic() {
        let sc = Scenario {
            matches: 100,
            reconnect_fraction: 0.25,
            slow_fraction: 0.05,
            ..Scenario::default()
        };
        let a = roles(&sc);
        assert_eq!(a, roles(&sc), "same seed, same roles");
        assert_ne!(
            a,
            roles(&Scenario {
                seed: 2,
                ..sc.clone()
            })
        );
        let rc = a
            .iter()
            .filter(|r| {
                matches!(
                    r,
                    Role::Normal {
                        reconnector: true,
                        ..
                    }
                )
            })
            .count() as f64
            / a.len() as f64;
        let sl = a
            .iter()
            .filter(|r| matches!(r, Role::Normal { slow: true, .. }))
            .count() as f64
            / a.len() as f64;
        assert!((rc - 0.25).abs() < 0.05, "{rc}");
        assert!((sl - 0.05).abs() < 0.03, "{sl}");
        let none = roles(&Scenario {
            reconnect_fraction: 0.0,
            slow_fraction: 0.0,
            ..sc
        });
        assert!(none.iter().all(|r| matches!(
            r,
            Role::Normal {
                reconnector: false,
                slow: false
            }
        )));
    }

    #[test]
    fn degradation_names_every_reason_and_is_empty_when_healthy() {
        let healthy =
            json!({"droppedSteps": 0, "stepUs": {"p99": 900}, "latenessUs": {"p99": 400}});
        assert!(degradation(&healthy, 52, 0, 100_000).is_empty());
        let bad =
            json!({"droppedSteps": 3, "stepUs": {"p99": 30_000}, "latenessUs": {"p99": 40_000}});
        let why = degradation(&bad, 250, 1_000, 100_000);
        assert_eq!(why.len(), 5, "{why:?}");
        assert!(
            degradation(&Value::Null, 99, 0, 0).is_empty(),
            "no server metrics: judged on the client alone"
        );
        assert_eq!(degradation(&Value::Null, 101, 0, 0).len(), 1);
        assert!(
            degradation(&healthy, 50, 400, 100_000).is_empty(),
            "0.4% missed is under the limit"
        );
    }

    #[test]
    fn insecure_tls_needs_the_flag() {
        let tls = Scenario {
            tls: true,
            ..Scenario::default()
        };
        assert!(connector(&tls).is_none(), "verified: default roots");
        assert!(matches!(
            connector(&Scenario {
                insecure: true,
                ..tls
            }),
            Some(tokio_tungstenite::Connector::Rustls(_))
        ));
        assert!(matches!(
            connector(&Scenario::default()),
            Some(tokio_tungstenite::Connector::Plain)
        ));
    }
}
