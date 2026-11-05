//! Scenario parameters and the command line that sets them. Hand-rolled (`--key value`, plus bare boolean flags) so the
//! harness adds no argument-parsing crate; unknown flags are errors, never silently ignored.

use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ShutdownMode {
    /// SIGTERM to the spawned server process (needs `--server-bin`; or `--pid` for an attached one).
    Sigterm,
    /// `POST /control/drain` on the control listener.
    Drain,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShutdownPlan {
    /// Seconds after the steady window opens.
    pub at_secs: f64,
    pub mode: ShutdownMode,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Scenario {
    /// Concurrent matches wanted, and humans per match (a lobby closes at 8, `MAX_PLAYERS`).
    pub matches: usize,
    pub players_per_match: usize,
    /// Matches started per second while ramping up.
    pub ramp_per_sec: f64,
    /// Milliseconds between the joins of one match's players.
    pub join_stagger_ms: u64,
    /// Steady-state seconds after the ramp.
    pub duration_secs: f64,
    /// Mean milliseconds between a player's input frames (a human acts a few times a second).
    pub think_ms: u64,
    /// 0..=1: how readily a scripted player attacks a visible enemy and walks toward it. 0 = movement only (matches never end).
    pub aggression: f64,
    /// A finished player queues for another match (true) or stops (false).
    pub rejoin: bool,
    /// Fraction of players that drop their socket and resume with the session token, every `reconnect_every_secs` on average.
    pub reconnect_fraction: f64,
    pub reconnect_every_secs: f64,
    /// Uniform range of milliseconds the dropped socket stays down before the resume (the server holds the seat 10 s).
    pub reconnect_delay_ms: (u64, u64),
    /// Extra clients that only join a lobby, linger a random time in this range (seconds), Leave and repeat.
    pub churn_clients: usize,
    pub churn_dwell_secs: (f64, f64),
    /// Fraction of players that stop reading their socket (a tiny receive buffer, so the server's writes back up) for
    /// `slow_stall_secs`, then report how the server ended them.
    pub slow_fraction: f64,
    pub slow_stall_secs: f64,
    pub shutdown: Option<ShutdownPlan>,
    /// Longest wait for the server to finish after a shutdown trigger.
    pub drain_wait_secs: f64,
    pub tls: bool,
    /// Accept any server certificate (self-signed local server). Never default.
    pub insecure: bool,
    pub seed: u64,
    pub sample_secs: f64,
    // Server settings used when the harness spawns the server itself.
    pub max_rooms: usize,
    pub min_players: usize,
    pub lobby_seconds: f64,
    pub fill_seconds: f64,
    pub fill_bots: usize,
}

impl Default for Scenario {
    fn default() -> Self {
        Self {
            matches: 4,
            players_per_match: 8,
            ramp_per_sec: 5.0,
            join_stagger_ms: 5,
            duration_secs: 20.0,
            think_ms: 150,
            aggression: 0.0,
            rejoin: true,
            reconnect_fraction: 0.0,
            reconnect_every_secs: 20.0,
            reconnect_delay_ms: (200, 1500),
            churn_clients: 0,
            churn_dwell_secs: (0.5, 3.0),
            slow_fraction: 0.0,
            slow_stall_secs: 20.0,
            shutdown: None,
            drain_wait_secs: 180.0,
            tls: false,
            insecure: false,
            seed: 1,
            sample_secs: 1.0,
            max_rooms: 1024,
            min_players: 8,
            lobby_seconds: 15.0,
            fill_seconds: 0.0,
            fill_bots: 0,
        }
    }
}

impl Scenario {
    pub fn total_players(&self) -> usize {
        self.matches * self.players_per_match
    }

    pub fn validate(&self) -> Result<(), String> {
        let bad = |m: &str| Err(m.to_string());
        // Bound allocations and every duration before any process or task starts. This is a
        // local experiment tool, with at most 100,000 clients and one day per phase.
        const MAX_CLIENTS: usize = 100_000;
        const MAX_SECS: f64 = 86_400.0;
        let clients = self
            .matches
            .checked_mul(self.players_per_match)
            .and_then(|n| n.checked_add(self.churn_clients))
            .and_then(|n| n.checked_add(1));
        if clients.is_none_or(|n| n > MAX_CLIENTS) {
            return bad("main, churn and probe clients must total at most 100000");
        }
        for (name, value) in [
            ("--duration", self.duration_secs),
            ("--reconnect-every", self.reconnect_every_secs),
            ("--slow-stall-secs", self.slow_stall_secs),
            ("--drain-wait", self.drain_wait_secs),
            ("--churn-dwell minimum", self.churn_dwell_secs.0),
            ("--churn-dwell maximum", self.churn_dwell_secs.1),
            ("--lobby-seconds", self.lobby_seconds),
            ("--fill-seconds", self.fill_seconds),
        ] {
            if !value.is_finite() || !(0.0..=MAX_SECS).contains(&value) {
                return Err(format!(
                    "{name} must be finite and within 0..=86400 seconds"
                ));
            }
        }
        if self
            .shutdown
            .is_some_and(|p| !p.at_secs.is_finite() || !(0.0..=MAX_SECS).contains(&p.at_secs))
        {
            return bad("--shutdown-at must be finite and within 0..=86400 seconds");
        }
        if self.reconnect_fraction > 0.0 && self.reconnect_every_secs == 0.0 {
            return bad("--reconnect-every must be positive for reconnecting clients");
        }
        if self.think_ms > 86_400_000 || self.join_stagger_ms > 86_400_000 {
            return bad("--think-ms and --join-stagger-ms must be at most 86400000");
        }
        if !self.sample_secs.is_finite() || self.sample_secs > 3600.0 {
            return bad("--sample-secs must be finite and at most 3600");
        }
        if self.max_rooms > MAX_CLIENTS
            || !(1..=8).contains(&self.min_players)
            || self.fill_bots > 8
        {
            return bad(
                "--max-rooms must be at most 100000, --min-players 1..=8, --fill-bots 0..=8",
            );
        }
        if self.matches == 0 {
            return bad("--matches must be at least 1");
        }
        if self.players_per_match == 0 || self.players_per_match > 8 {
            return bad("--players-per-match must be 1..=8 (the lobby cap)");
        }
        if !(self.ramp_per_sec > 0.0 && self.ramp_per_sec.is_finite()) {
            return bad("--ramp-per-sec must be positive");
        }
        let ramp_secs = self.matches.saturating_sub(1) as f64 / self.ramp_per_sec
            + self.players_per_match.saturating_sub(1) as f64 * self.join_stagger_ms as f64
                / 1000.0;
        if !ramp_secs.is_finite() || ramp_secs > MAX_SECS {
            return bad("ramp schedule must finish within 86400 seconds");
        }
        if !(self.duration_secs >= 0.0 && self.duration_secs.is_finite()) {
            return bad("--duration must be non-negative");
        }
        if self.think_ms < 20 {
            return bad("--think-ms below 20 would exceed the server's input rate bucket");
        }
        for (name, v) in [
            ("--aggression", self.aggression),
            ("--reconnect-fraction", self.reconnect_fraction),
            ("--slow-fraction", self.slow_fraction),
        ] {
            if !(0.0..=1.0).contains(&v) {
                return Err(format!("{name} must be within 0..=1"));
            }
        }
        if self.reconnect_delay_ms.0 > self.reconnect_delay_ms.1 || self.reconnect_delay_ms.1 > 8000
        {
            return bad("--reconnect-delay-ms needs min:max with max <= 8000 (resume must land inside the 10 s grace)");
        }
        if self.churn_dwell_secs.0 > self.churn_dwell_secs.1 || self.churn_dwell_secs.0 < 0.0 {
            return bad("--churn-dwell needs min:max seconds");
        }
        if self.insecure && !self.tls {
            return bad("--insecure only makes sense with --tls");
        }
        if self.sample_secs.is_nan() || self.sample_secs < 0.1 {
            return bad("--sample-secs must be at least 0.1");
        }
        if self.max_rooms == 0 {
            return bad("--max-rooms must be at least 1");
        }
        Ok(())
    }

    pub fn json(&self) -> Value {
        json!({
            "matches": self.matches, "playersPerMatch": self.players_per_match, "totalPlayers": self.total_players(),
            "rampPerSec": self.ramp_per_sec, "joinStaggerMs": self.join_stagger_ms, "durationSecs": self.duration_secs,
            "thinkMs": self.think_ms, "aggression": self.aggression, "rejoin": self.rejoin,
            "reconnectFraction": self.reconnect_fraction, "reconnectEverySecs": self.reconnect_every_secs,
            "reconnectDelayMs": [self.reconnect_delay_ms.0, self.reconnect_delay_ms.1],
            "churnClients": self.churn_clients, "churnDwellSecs": [self.churn_dwell_secs.0, self.churn_dwell_secs.1],
            "slowFraction": self.slow_fraction, "slowStallSecs": self.slow_stall_secs,
            "shutdown": self.shutdown.map(|s| json!({"atSecs": s.at_secs,
                "mode": match s.mode { ShutdownMode::Sigterm => "sigterm", ShutdownMode::Drain => "drain" }})),
            "drainWaitSecs": self.drain_wait_secs, "tls": self.tls, "insecure": self.insecure, "seed": self.seed,
            "sampleSecs": self.sample_secs, "maxRooms": self.max_rooms, "minPlayers": self.min_players,
            "lobbySeconds": self.lobby_seconds, "fillSeconds": self.fill_seconds, "fillBots": self.fill_bots,
        })
    }
}

/// `--key value` pairs and bare flags, with a record of what was read so leftovers can be refused.
#[derive(Debug)]
pub struct ArgMap {
    values: BTreeMap<String, String>,
    flags: Vec<String>,
}

/// Flags that take no value.
pub const BOOL_FLAGS: &[&str] = &[
    "--tls",
    "--insecure",
    "--no-rejoin",
    "--emulated",
    "--dev-auth",
    "--keep-creds",
    "--stop-at-degrade",
];

impl ArgMap {
    pub fn parse(args: &[String]) -> Result<Self, String> {
        let mut values = BTreeMap::new();
        let mut flags = Vec::new();
        let mut i = 0;
        while i < args.len() {
            let a = &args[i];
            if !a.starts_with("--") {
                return Err(format!("unexpected argument {a:?}"));
            }
            if BOOL_FLAGS.contains(&a.as_str()) {
                flags.push(a.clone());
                i += 1;
                continue;
            }
            let v = args
                .get(i + 1)
                .ok_or_else(|| format!("{a} needs a value"))?;
            if v.starts_with("--") {
                return Err(format!("{a} needs a value, got {v}"));
            }
            if values.insert(a.clone(), v.clone()).is_some() {
                return Err(format!("{a} given twice"));
            }
            i += 2;
        }
        Ok(Self { values, flags })
    }

    pub fn flag(&mut self, k: &str) -> bool {
        let had = self.flags.iter().any(|f| f == k);
        self.flags.retain(|f| f != k);
        had
    }

    pub fn take(&mut self, k: &str) -> Option<String> {
        self.values.remove(k)
    }

    pub fn num<T: std::str::FromStr>(&mut self, k: &str) -> Result<Option<T>, String> {
        match self.take(k) {
            None => Ok(None),
            Some(v) => v
                .parse::<T>()
                .map(Some)
                .map_err(|_| format!("{k}: cannot parse {v:?}")),
        }
    }

    pub fn range<T: std::str::FromStr>(&mut self, k: &str) -> Result<Option<(T, T)>, String> {
        match self.take(k) {
            None => Ok(None),
            Some(v) => {
                let (a, b) = v
                    .split_once(':')
                    .ok_or_else(|| format!("{k} needs min:max"))?;
                let p = |s: &str| {
                    s.parse::<T>()
                        .map_err(|_| format!("{k}: cannot parse {s:?}"))
                };
                Ok(Some((p(a)?, p(b)?)))
            }
        }
    }

    /// Everything must have been consumed.
    pub fn finish(self) -> Result<(), String> {
        let mut left: Vec<&String> = self.values.keys().chain(self.flags.iter()).collect();
        left.sort();
        if left.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "unknown option(s): {}",
                left.iter()
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            ))
        }
    }
}

/// Reads the scenario options out of `m` (leaving the others for the caller) and validates the result.
pub fn scenario_from(m: &mut ArgMap) -> Result<Scenario, String> {
    let mut s = Scenario::default();
    macro_rules! set {
        ($field:ident, $key:literal) => {
            if let Some(v) = m.num($key)? {
                s.$field = v;
            }
        };
    }
    set!(matches, "--matches");
    set!(players_per_match, "--players-per-match");
    set!(ramp_per_sec, "--ramp-per-sec");
    set!(join_stagger_ms, "--join-stagger-ms");
    set!(duration_secs, "--duration");
    set!(think_ms, "--think-ms");
    set!(aggression, "--aggression");
    set!(reconnect_fraction, "--reconnect-fraction");
    set!(reconnect_every_secs, "--reconnect-every");
    set!(churn_clients, "--churn-clients");
    set!(slow_fraction, "--slow-fraction");
    set!(slow_stall_secs, "--slow-stall-secs");
    set!(drain_wait_secs, "--drain-wait");
    set!(seed, "--seed");
    set!(sample_secs, "--sample-secs");
    set!(max_rooms, "--max-rooms");
    set!(min_players, "--min-players");
    set!(lobby_seconds, "--lobby-seconds");
    set!(fill_seconds, "--fill-seconds");
    set!(fill_bots, "--fill-bots");
    if let Some(r) = m.range("--reconnect-delay-ms")? {
        s.reconnect_delay_ms = r;
    }
    if let Some(r) = m.range("--churn-dwell")? {
        s.churn_dwell_secs = r;
    }
    s.tls = m.flag("--tls");
    s.insecure = m.flag("--insecure");
    if m.flag("--no-rejoin") {
        s.rejoin = false;
    }
    if let Some(at) = m.num::<f64>("--shutdown-at")? {
        let mode = match m.take("--shutdown-mode").as_deref() {
            None | Some("sigterm") => ShutdownMode::Sigterm,
            Some("drain") => ShutdownMode::Drain,
            Some(o) => return Err(format!("--shutdown-mode must be sigterm or drain, got {o}")),
        };
        s.shutdown = Some(ShutdownPlan { at_secs: at, mode });
    } else if m.take("--shutdown-mode").is_some() {
        return Err("--shutdown-mode needs --shutdown-at".into());
    }
    s.validate()?;
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(a: &[&str]) -> Result<Scenario, String> {
        let v: Vec<String> = a.iter().map(|s| s.to_string()).collect();
        let mut m = ArgMap::parse(&v)?;
        let s = scenario_from(&mut m)?;
        m.finish()?;
        Ok(s)
    }

    #[test]
    fn nonfinite_and_overflowing_scenarios_are_refused_before_work_starts() {
        for args in [
            vec!["--sample-secs", "inf"],
            vec!["--reconnect-every", "NaN"],
            vec!["--reconnect-every", "-1"],
            vec!["--slow-stall-secs", "NaN"],
            vec!["--drain-wait", "-1"],
            vec!["--churn-dwell", "NaN:1"],
            vec!["--shutdown-at", "NaN"],
            vec!["--matches", "18446744073709551615"],
        ] {
            assert!(parse(&args).is_err(), "must refuse {args:?}");
        }
    }

    #[test]
    fn defaults_are_valid_and_total_players_multiplies() {
        let s = parse(&[]).unwrap();
        assert_eq!(
            (s.matches, s.players_per_match, s.total_players()),
            (4, 8, 32)
        );
        assert_eq!(
            parse(&["--matches", "200", "--players-per-match", "8"])
                .unwrap()
                .total_players(),
            1600
        );
    }

    #[test]
    fn every_scenario_parameter_parses() {
        let s = parse(&[
            "--matches",
            "10",
            "--players-per-match",
            "4",
            "--ramp-per-sec",
            "2.5",
            "--duration",
            "60",
            "--think-ms",
            "200",
            "--aggression",
            "0.4",
            "--reconnect-fraction",
            "0.1",
            "--reconnect-every",
            "30",
            "--reconnect-delay-ms",
            "100:900",
            "--churn-clients",
            "6",
            "--churn-dwell",
            "1:2.5",
            "--slow-fraction",
            "0.05",
            "--slow-stall-secs",
            "30",
            "--shutdown-at",
            "12",
            "--shutdown-mode",
            "drain",
            "--drain-wait",
            "90",
            "--tls",
            "--insecure",
            "--no-rejoin",
            "--seed",
            "9",
            "--max-rooms",
            "5",
        ])
        .unwrap();
        assert_eq!(
            (
                s.matches,
                s.players_per_match,
                s.think_ms,
                s.churn_clients,
                s.max_rooms
            ),
            (10, 4, 200, 6, 5)
        );
        assert_eq!(s.reconnect_delay_ms, (100, 900));
        assert_eq!(s.churn_dwell_secs, (1.0, 2.5));
        assert_eq!(
            s.shutdown,
            Some(ShutdownPlan {
                at_secs: 12.0,
                mode: ShutdownMode::Drain
            })
        );
        assert!(s.tls && s.insecure && !s.rejoin);
        assert_eq!(s.json()["shutdown"]["mode"], "drain");
    }

    #[test]
    fn invalid_input_is_refused_with_a_reason() {
        for bad in [
            vec!["--matches", "0"],
            vec!["--players-per-match", "9"],
            vec!["--aggression", "1.5"],
            vec!["--think-ms", "5"],
            vec!["--ramp-per-sec", "0"],
            vec!["--reconnect-delay-ms", "900:100"],
            vec!["--reconnect-delay-ms", "100:99999"],
            vec!["--reconnect-delay-ms", "100"],
            vec!["--insecure"],
            vec!["--shutdown-mode", "drain"],
            vec!["--shutdown-at", "5", "--shutdown-mode", "kill"],
            vec!["--matches"],
            vec!["--matches", "--tls"],
            vec!["--matches", "x"],
            vec!["--bogus", "1"],
            vec!["stray"],
            vec!["--matches", "1", "--matches", "2"],
        ] {
            assert!(parse(&bad).is_err(), "{bad:?} must be refused");
        }
    }

    #[test]
    fn leftover_options_are_reported_by_finish() {
        let v: Vec<String> = ["--matches", "2", "--server-bin", "x"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let mut m = ArgMap::parse(&v).unwrap();
        scenario_from(&mut m).unwrap();
        assert_eq!(m.take("--server-bin").as_deref(), Some("x"));
        m.finish().unwrap();
    }
}
