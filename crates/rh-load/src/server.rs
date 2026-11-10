//! Spawning (or attaching to) the server under test, and measuring its cold start.

use crate::scenario::Scenario;
use crate::sys::{get_json, Creds};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::process::{Child, Command};

#[derive(Clone, Debug, Default)]
pub struct ServerSpec {
    /// Spawn this `rh-server` binary (a `--release` build for baselines). `None`: attach to `attach`.
    pub bin: Option<PathBuf>,
    /// Extra arguments appended to the spawned server's command line (whitespace separated).
    pub extra_args: Vec<String>,
    /// Attach mode: the public `host:port` and the loopback control address of a server somebody else started.
    pub attach_public: Option<SocketAddr>,
    pub attach_control: Option<SocketAddr>,
    /// Attach mode: the server's pid on this host, for CPU/RSS sampling and SIGTERM.
    pub attach_pid: Option<u32>,
    /// Server uses `--auth dev` (attach mode, or a spawn that should not use a static file).
    pub dev_auth: bool,
    /// Override of the build profile label ("release", "debug"); otherwise guessed from the binary path.
    pub build_profile: Option<String>,
}

pub struct Running {
    pub public: SocketAddr,
    pub control: Option<SocketAddr>,
    pub pid: Option<u32>,
    pub child: Option<Child>,
    pub cold_control_ms: Option<f64>,
    pub cold_public_ms: Option<f64>,
    pub log_path: Option<PathBuf>,
    pub argv: Vec<String>,
    pub auth_file: Option<PathBuf>,
}

/// Owns credentials until startup successfully hands cleanup responsibility to `Running`.
struct StartupAuth(Option<PathBuf>);

impl Drop for StartupAuth {
    fn drop(&mut self) {
        if let Some(path) = &self.0 {
            let _ = std::fs::remove_file(path);
        }
    }
}

pub fn free_port() -> std::io::Result<u16> {
    Ok(std::net::TcpListener::bind("127.0.0.1:0")?
        .local_addr()?
        .port())
}

/// The `rh-server` command line for `sc` (no binary name). The auth file path is part of it (the file holds throwaway tokens
/// and lives under `target/`; the path itself is not a secret).
pub fn server_args(
    sc: &Scenario,
    public: SocketAddr,
    control: SocketAddr,
    auth: Option<&Path>,
    extra: &[String],
) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "--bind".into(),
        public.to_string(),
        "--control".into(),
        control.to_string(),
        // The load tool talks to its own throwaway server over loopback; rh-server requires this to run `--control` untokened.
        "--control-insecure-loopback".into(),
        "--max-rooms".into(),
        sc.max_rooms.to_string(),
        "--min-players".into(),
        sc.min_players.to_string(),
        "--lobby-seconds".into(),
        sc.lobby_seconds.to_string(),
        "--fill-seconds".into(),
        sc.fill_seconds.to_string(),
        "--fill-bots".into(),
        sc.fill_bots.to_string(),
    ];
    if let Some(p) = auth {
        a.push("--auth".into());
        a.push(format!("static:{}", p.display()));
    }
    if sc.tls {
        a.push("--self-signed".into());
    }
    a.extend(extra.iter().cloned());
    a
}

pub fn guess_profile(bin: &Path) -> &'static str {
    let s = bin.to_string_lossy();
    if s.contains("/release/") {
        "release"
    } else if s.contains("/debug/") {
        "debug"
    } else {
        "unknown"
    }
}

/// Starts the server, waits for `GET /control/health` = 200 (cold start) and for the public port to accept TCP.
pub async fn start(
    sc: &Scenario,
    spec: &ServerSpec,
    creds: &Creds,
    out_dir: &Path,
    label: &str,
) -> Result<Running, String> {
    sc.validate()?;
    if spec
        .attach_pid
        .is_some_and(|pid| pid == 0 || pid > i32::MAX as u32)
    {
        return Err("--pid must name one process (1..=2147483647)".into());
    }
    if let Some(public) = spec.attach_public {
        let control = spec.attach_control;
        let t0 = Instant::now();
        if let Some(c) = control {
            let (code, _) = get_json(c, "/control/health")
                .await
                .ok_or("attached server: control health unreachable")?;
            if code != 200 {
                return Err(format!(
                    "attached server is not ready (control health {code})"
                ));
            }
        }
        return Ok(Running {
            public,
            control,
            pid: spec.attach_pid,
            child: None,
            cold_control_ms: None,
            cold_public_ms: Some(t0.elapsed().as_secs_f64() * 1000.0),
            log_path: None,
            argv: vec![],
            auth_file: None,
        });
    }
    let bin = spec
        .bin
        .as_ref()
        .ok_or("no --server-bin and no --target: nothing to test")?;
    let public: SocketAddr = format!("127.0.0.1:{}", free_port().map_err(|e| e.to_string())?)
        .parse()
        .expect("addr");
    let control: SocketAddr = format!("127.0.0.1:{}", free_port().map_err(|e| e.to_string())?)
        .parse()
        .expect("addr");
    let mut startup_auth = StartupAuth(None);
    let auth_file = if spec.dev_auth {
        None
    } else {
        let p = out_dir.join(format!("{label}.auth.tmp"));
        startup_auth.0 = Some(p.clone());
        creds
            .write_static_file(&p)
            .map_err(|e| format!("write auth file: {e}"))?;
        Some(p)
    };
    let argv = server_args(sc, public, control, auth_file.as_deref(), &spec.extra_args);
    let log_path = out_dir.join(format!("{label}.server.log"));
    let log = std::fs::File::create(&log_path).map_err(|e| format!("server log: {e}"))?;
    let log2 = log.try_clone().map_err(|e| e.to_string())?;
    let spawned = Instant::now();
    let mut child = Command::new(bin)
        .args(&argv)
        .stdout(log)
        .stderr(log2)
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("spawn {}: {e}", bin.display()))?;
    let pid = child.id();
    let mut cold_control = None;
    let mut cold_public = None;
    let deadline = spawned + Duration::from_secs(60);
    while cold_control.is_none() || cold_public.is_none() {
        if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
            return Err(format!(
                "server exited during startup ({st}); see {}",
                log_path.display()
            ));
        }
        if Instant::now() > deadline {
            let _ = child.kill().await;
            return Err("server did not become ready within 60 s".into());
        }
        if cold_control.is_none() {
            if let Some((200, _)) = get_json(control, "/control/health").await {
                cold_control = Some(spawned.elapsed().as_secs_f64() * 1000.0);
            }
        }
        if cold_public.is_none() && tokio::net::TcpStream::connect(public).await.is_ok() {
            cold_public = Some(spawned.elapsed().as_secs_f64() * 1000.0);
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    startup_auth.0 = None;
    Ok(Running {
        public,
        control: Some(control),
        pid,
        child: Some(child),
        cold_control_ms: cold_control,
        cold_public_ms: cold_public,
        log_path: Some(log_path),
        argv,
        auth_file,
    })
}

/// SIGTERM (what a container platform sends). Unix only.
pub fn sigterm(pid: u32) -> bool {
    // kill(0, SIGTERM) signals the caller's entire process group.
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    std::process::Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status()
        .is_ok_and(|s| s.success())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn invalid_scenario_is_refused_before_startup_side_effects() {
        let dir = std::env::temp_dir().join(format!(
            "rh-load-invalid-scenario-{}",
            crate::sys::random_hex(8)
        ));
        let sc = Scenario {
            sample_secs: f64::INFINITY,
            ..Scenario::default()
        };
        let spec = ServerSpec {
            bin: Some(dir.join("nonexistent-server")),
            ..ServerSpec::default()
        };
        let error = start(&sc, &spec, &Creds::generate(1), &dir, "invalid")
            .await
            .err()
            .expect("invalid scenario must be refused");
        assert!(error.contains("--sample-secs"), "{error}");
        assert!(
            !dir.exists(),
            "invalid startup must create no output or auth file"
        );
    }

    #[tokio::test]
    async fn failed_start_removes_throwaway_auth_file() {
        let dir = std::env::temp_dir().join(format!(
            "rh-load-failed-start-{}",
            crate::sys::random_hex(8)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let spec = ServerSpec {
            bin: Some(dir.join("nonexistent-server")),
            ..Default::default()
        };
        let result = start(
            &Scenario::default(),
            &spec,
            &Creds::generate(1),
            &dir,
            "startup",
        )
        .await;
        assert!(result.is_err());
        let leaked = dir.join("startup.auth.tmp").exists();
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(!leaked, "failed spawn must remove credentials too");
    }

    #[test]
    fn sigterm_refuses_process_groups_without_spawning_kill() {
        assert!(!sigterm(0));
        assert!(!sigterm(u32::MAX));
    }

    #[test]
    fn server_args_follow_the_scenario() {
        let sc = Scenario {
            max_rooms: 7,
            min_players: 3,
            lobby_seconds: 12.0,
            fill_bots: 2,
            tls: true,
            ..Scenario::default()
        };
        let a = server_args(
            &sc,
            "127.0.0.1:1".parse().unwrap(),
            "127.0.0.1:2".parse().unwrap(),
            Some(Path::new("/x/auth")),
            &["--map".into(), "m.json".into()],
        );
        let pairs = |k: &str| a.iter().position(|x| x == k).map(|i| a[i + 1].clone());
        assert_eq!(pairs("--max-rooms").as_deref(), Some("7"));
        assert_eq!(pairs("--min-players").as_deref(), Some("3"));
        assert_eq!(pairs("--lobby-seconds").as_deref(), Some("12"));
        assert_eq!(pairs("--fill-bots").as_deref(), Some("2"));
        assert_eq!(pairs("--auth").as_deref(), Some("static:/x/auth"));
        assert_eq!(pairs("--control").as_deref(), Some("127.0.0.1:2"));
        assert!(a.contains(&"--self-signed".to_string()) && a.contains(&"--map".to_string()));
        let plain = server_args(
            &Scenario::default(),
            "127.0.0.1:1".parse().unwrap(),
            "127.0.0.1:2".parse().unwrap(),
            None,
            &[],
        );
        assert!(
            !plain.contains(&"--auth".to_string()) && !plain.contains(&"--self-signed".to_string())
        );
    }

    #[test]
    fn profile_is_guessed_from_the_path() {
        assert_eq!(
            guess_profile(Path::new("/w/target/release/rh-server")),
            "release"
        );
        assert_eq!(
            guess_profile(Path::new("/w/target/debug/rh-server")),
            "debug"
        );
        assert_eq!(guess_profile(Path::new("/usr/bin/rh-server")), "unknown");
    }
}
