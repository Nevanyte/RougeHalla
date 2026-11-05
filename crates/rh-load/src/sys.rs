//! Host-facing helpers: a minimal HTTP/1.1 client for the loopback control listener, process CPU/RSS sampling through
//! `ps` (macOS and Linux), run metadata (git revision, hardware, OS) and throwaway credentials.

use serde_json::{json, Value};
use std::net::SocketAddr;
use std::process::Command;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// One HTTP/1.1 request with `Connection: close`; returns (status, body). The control API answers small JSON documents with a
/// Content-Length, so no chunked decoding is needed (a chunked body is returned raw).
pub async fn http(
    addr: SocketAddr,
    method: &str,
    path: &str,
    timeout: Duration,
) -> std::io::Result<(u16, String)> {
    let work = async {
        let mut s = tokio::net::TcpStream::connect(addr).await?;
        let req = format!("{method} {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        s.write_all(req.as_bytes()).await?;
        let mut buf = Vec::new();
        s.read_to_end(&mut buf).await?;
        parse_response(&buf).ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "bad HTTP response")
        })
    };
    tokio::time::timeout(timeout, work)
        .await
        .unwrap_or_else(|_| {
            Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "http timeout",
            ))
        })
}

pub fn parse_response(buf: &[u8]) -> Option<(u16, String)> {
    let text = String::from_utf8_lossy(buf);
    let (head, body) = text.split_once("\r\n\r\n")?;
    let status = head
        .lines()
        .next()?
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()?;
    Some((status, body.to_string()))
}

pub async fn get_json(addr: SocketAddr, path: &str) -> Option<(u16, Value)> {
    let (code, body) = http(addr, "GET", path, Duration::from_secs(5)).await.ok()?;
    Some((code, serde_json::from_str(&body).unwrap_or(Value::Null)))
}

/// Cumulative CPU seconds from `ps -o cputime` text: `MM:SS.hh`, `H:MM:SS(.hh)` or `D-HH:MM:SS`.
pub fn parse_cputime(s: &str) -> Option<f64> {
    let s = s.trim();
    let (days, rest) = match s.split_once('-') {
        Some((d, r)) => (d.parse::<f64>().ok()?, r),
        None => (0.0, s),
    };
    let mut total = 0.0;
    for part in rest.split(':') {
        total = total * 60.0 + part.parse::<f64>().ok()?;
    }
    Some(days * 86400.0 + total)
}

/// (cumulative CPU seconds, resident bytes) of `pid`, or None if the process is gone. `ps -o cputime=,rss=`: rss is in KiB.
/// The CPU time has 10 ms resolution on macOS and 1 s on Linux, so rates over sub-second windows are noise; the harness samples
/// every second and also reports the whole-run average from the first and last readings.
pub fn sample_process(pid: u32) -> Option<(f64, u64)> {
    let out = Command::new("ps")
        .args(["-o", "cputime=,rss=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut it = text.split_whitespace();
    let cpu = parse_cputime(it.next()?)?;
    let rss_kib: u64 = it.next()?.parse().ok()?;
    Some((cpu, rss_kib * 1024))
}

fn cmd(program: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(program).args(args).output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Git revision of `dir` (or the working directory), with a `-dirty` marker when tracked files differ.
pub fn git_revision() -> String {
    let rev = cmd("git", &["rev-parse", "HEAD"]).unwrap_or_else(|| "unknown".into());
    let dirty = cmd("git", &["status", "--porcelain", "--untracked-files=no"])
        .is_some_and(|s| !s.is_empty());
    if dirty {
        format!("{rev}-dirty")
    } else {
        rev
    }
}

/// Run metadata every output records (docs/hosting/LOAD_BASELINE.md). `label` overrides the detected hardware string.
pub fn host_meta(hardware_label: Option<&str>, emulated: bool) -> Value {
    let (cpu, mem_bytes, cores) = if cfg!(target_os = "macos") {
        (
            cmd("sysctl", &["-n", "machdep.cpu.brand_string"]),
            cmd("sysctl", &["-n", "hw.memsize"]).and_then(|s| s.parse::<u64>().ok()),
            cmd("sysctl", &["-n", "hw.ncpu"]).and_then(|s| s.parse::<u64>().ok()),
        )
    } else {
        let info = std::fs::read_to_string("/proc/cpuinfo").unwrap_or_default();
        let model = info
            .lines()
            .find(|l| l.starts_with("model name"))
            .and_then(|l| l.split_once(':'))
            .map(|(_, v)| v.trim().to_string());
        let mem = std::fs::read_to_string("/proc/meminfo").ok().and_then(|m| {
            m.lines()
                .find(|l| l.starts_with("MemTotal:"))
                .and_then(|l| l.split_whitespace().nth(1)?.parse::<u64>().ok())
                .map(|kb| kb * 1024)
        });
        (
            model,
            mem,
            std::thread::available_parallelism()
                .ok()
                .map(|n| n.get() as u64),
        )
    };
    json!({
        "hardwareLabel": hardware_label,
        "cpu": cpu,
        "logicalCores": cores,
        "memoryBytes": mem_bytes,
        "os": cmd("uname", &["-sr"]),
        "arch": std::env::consts::ARCH,
        "emulated": emulated,
        "harnessBuild": if cfg!(debug_assertions) { "debug" } else { "release" },
    })
}

/// A throwaway generator state from the clock, the pid and the OS RNG. Credentials made from it are random per run.
pub fn random_hex(bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    getrandom::getrandom(&mut b).expect("os rng");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

#[derive(Clone, Debug)]
pub struct Creds {
    /// (callsign, token) in the order players are numbered: main players first, then churn clients, then the probe.
    pub entries: Vec<(String, String)>,
}

impl Creds {
    /// `count` throwaway callsign/token pairs. Callsigns are `lt<run><n>` (valid: 2-16 of A-Z a-z 0-9 _ -), tokens 32 hex digits.
    pub fn generate(count: usize) -> Self {
        let run = random_hex(2);
        Self {
            entries: (0..count)
                .map(|i| (format!("lt{run}p{i}"), random_hex(16)))
                .collect(),
        }
    }

    /// The `--auth static:<file>` text: one `callsign token` per line.
    pub fn static_file_text(&self) -> String {
        self.entries
            .iter()
            .map(|(c, t)| format!("{c} {t}\n"))
            .collect()
    }

    /// Writes the static auth file readable by the owner only. Never committed: callers put it under `target/` or a temp dir.
    pub fn write_static_file(&self, path: &std::path::Path) -> std::io::Result<()> {
        use std::io::Write;
        let mut o = std::fs::OpenOptions::new();
        o.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            o.mode(0o600);
        }
        o.open(path)?.write_all(self.static_file_text().as_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cputime_formats() {
        assert_eq!(parse_cputime("0:12.34"), Some(12.34));
        assert_eq!(parse_cputime("1:02:03.50"), Some(3723.5));
        assert_eq!(parse_cputime("00:00:07"), Some(7.0));
        assert_eq!(parse_cputime("2-01:00:00"), Some(2.0 * 86400.0 + 3600.0));
        assert_eq!(parse_cputime("junk"), None);
        assert_eq!(parse_cputime(""), None);
    }

    #[test]
    fn http_response_parsing() {
        let r = b"HTTP/1.1 503 Service Unavailable\r\ncontent-length: 2\r\n\r\n{}";
        assert_eq!(parse_response(r), Some((503, "{}".to_string())));
        assert_eq!(parse_response(b"garbage"), None);
        assert_eq!(parse_response(b"HTTP/1.1 abc\r\n\r\nx"), None);
    }

    #[test]
    fn credentials_are_valid_callsigns_unique_and_formatted_for_static_auth() {
        let c = Creds::generate(300);
        let mut names: Vec<&String> = c.entries.iter().map(|(n, _)| n).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), 300);
        for (n, t) in &c.entries {
            assert!(
                (2..=16).contains(&n.len())
                    && n.chars()
                        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-'),
                "{n}"
            );
            assert_eq!(t.len(), 32);
        }
        let text = c.static_file_text();
        assert_eq!(text.lines().count(), 300);
        assert!(text.lines().all(|l| l.split_once(' ').is_some()));
    }

    #[test]
    fn the_current_process_can_be_sampled() {
        let (cpu, rss) = sample_process(std::process::id()).expect("ps works on this host");
        assert!(cpu >= 0.0 && rss > 1024 * 1024);
        assert!(sample_process(u32::MAX - 1).is_none());
    }

    #[test]
    fn host_meta_records_arch_and_emulation() {
        let m = host_meta(Some("label"), true);
        assert_eq!(m["emulated"], true);
        assert_eq!(m["arch"], std::env::consts::ARCH);
        assert_eq!(m["hardwareLabel"], "label");
    }
}
