//! State shared by every scripted client of one run: counters, sample lists and the stop flags.

use crate::scenario::Scenario;
use crate::script::Floors;
use crate::stats::MsHist;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio_tungstenite::Connector;

/// Where the clients connect.
#[derive(Clone)]
pub struct Target {
    /// `ws://host:port/ws` or `wss://...`.
    pub ws_url: String,
    pub host_port: String,
    pub connector: Option<Connector>,
}

#[derive(Default)]
pub struct Counters {
    pub connected_now: AtomicU64,
    pub connect_attempts: AtomicU64,
    pub connect_errors: AtomicU64,
    pub welcomes_fresh: AtomicU64,
    /// Distinct scripted players that were admitted at least once.
    pub players_admitted: AtomicU64,
    pub welcomes_resume: AtomicU64,
    pub results: AtomicU64,
    pub snapshots: AtomicU64,
    pub late_snapshots_100ms: AtomicU64,
    pub late_snapshots_200ms: AtomicU64,
    pub late_snapshots_500ms: AtomicU64,
    pub ticks_missed: AtomicU64,
    pub bytes_in: AtomicU64,
    pub bytes_out: AtomicU64,
    pub frames_in: AtomicU64,
    pub inputs_sent: AtomicU64,
    pub decode_errors: AtomicU64,
    pub reconnect_attempts: AtomicU64,
    pub reconnect_ok: AtomicU64,
    pub reconnect_failed: AtomicU64,
    pub slow_started: AtomicU64,
    pub churn_joins: AtomicU64,
    pub churn_leaves: AtomicU64,
    pub sessions_ended_abnormally: AtomicU64,
    pub rejected_total: AtomicU64,
    // After the shutdown trigger.
    pub post_results: AtomicU64,
    pub post_fresh_welcomes: AtomicU64,
    pub post_resume_welcomes: AtomicU64,
    pub post_abnormal_ends: AtomicU64,
}

#[derive(Default)]
pub struct Lists {
    pub connect_ms: Vec<f64>,
    /// Hello sent -> Welcome received: admission/placement latency as a client sees it.
    pub hello_to_welcome_ms: Vec<f64>,
    pub resume_hello_to_welcome_ms: Vec<f64>,
    pub welcome_to_first_snapshot_ms: Vec<f64>,
    /// (bytes in, bytes out, connected seconds) per play session.
    pub per_client: Vec<(u64, u64, f64)>,
    pub refusals: BTreeMap<String, u64>,
    pub post_refusals: BTreeMap<String, u64>,
    pub reconnect_failures: BTreeMap<String, u64>,
    pub slow_outcomes: BTreeMap<String, u64>,
    pub errors: BTreeMap<String, u64>,
}

pub struct Shared {
    pub sc: Scenario,
    pub target: Target,
    pub content_hash: u64,
    pub start: Instant,
    /// Cleared on shutdown of the run: every client Leaves and exits.
    pub stop: AtomicBool,
    /// Snapshot-interval statistics only count while this is set (the steady window).
    pub measuring: AtomicBool,
    /// Milliseconds since `start` at which the shutdown was triggered; -1 before.
    pub trigger_ms: AtomicI64,
    pub c: Counters,
    pub lists: Mutex<Lists>,
    pub snapshot_interval_ms: MsHist,
    pub floors: Mutex<Option<(u32, Arc<Floors>)>>,
}

impl Shared {
    pub fn new(sc: Scenario, target: Target, content_hash: u64) -> Arc<Self> {
        Arc::new(Self {
            sc,
            target,
            content_hash,
            start: Instant::now(),
            stop: AtomicBool::new(false),
            measuring: AtomicBool::new(false),
            trigger_ms: AtomicI64::new(-1),
            c: Counters::default(),
            lists: Mutex::new(Lists::default()),
            snapshot_interval_ms: MsHist::default(),
            floors: Mutex::new(None),
        })
    }

    pub fn stopped(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
    }

    pub fn triggered(&self) -> bool {
        self.trigger_ms.load(Ordering::Relaxed) >= 0
    }

    pub fn bump(&self, f: impl Fn(&Counters) -> &AtomicU64) {
        f(&self.c).fetch_add(1, Ordering::Relaxed);
    }

    pub fn push(&self, f: impl FnOnce(&mut Lists)) {
        f(&mut self.lists.lock().expect("lists"));
    }

    pub fn count_map(
        &self,
        pick: impl FnOnce(&mut Lists) -> &mut BTreeMap<String, u64>,
        key: &str,
    ) {
        let mut l = self.lists.lock().expect("lists");
        *pick(&mut l).entry(key.to_string()).or_insert(0) += 1;
    }

    /// The shared floor list for the map with `layer_hash`, built from the first client's Welcome.
    pub fn floors_for(&self, layer_hash: u32, build: impl FnOnce() -> Floors) -> Arc<Floors> {
        let mut g = self.floors.lock().expect("floors");
        match &*g {
            Some((h, f)) if *h == layer_hash => f.clone(),
            _ => {
                let f = Arc::new(build());
                *g = Some((layer_hash, f.clone()));
                f
            }
        }
    }

    /// The counters as a JSON object (the live subset is also sampled into the time series).
    pub fn counters_json(&self) -> Value {
        let n = |a: &AtomicU64| a.load(Ordering::Relaxed);
        let c = &self.c;
        let mut m = Map::new();
        for (k, v) in [
            ("connectAttempts", &c.connect_attempts),
            ("connectErrors", &c.connect_errors),
            ("welcomesFresh", &c.welcomes_fresh),
            ("playersAdmitted", &c.players_admitted),
            ("welcomesResume", &c.welcomes_resume),
            ("results", &c.results),
            ("snapshots", &c.snapshots),
            ("lateSnapshots100ms", &c.late_snapshots_100ms),
            ("lateSnapshots200ms", &c.late_snapshots_200ms),
            ("lateSnapshots500ms", &c.late_snapshots_500ms),
            ("ticksMissed", &c.ticks_missed),
            ("bytesIn", &c.bytes_in),
            ("bytesOut", &c.bytes_out),
            ("framesIn", &c.frames_in),
            ("inputsSent", &c.inputs_sent),
            ("decodeErrors", &c.decode_errors),
            ("reconnectAttempts", &c.reconnect_attempts),
            ("reconnectOk", &c.reconnect_ok),
            ("reconnectFailed", &c.reconnect_failed),
            ("slowStarted", &c.slow_started),
            ("churnJoins", &c.churn_joins),
            ("churnLeaves", &c.churn_leaves),
            ("sessionsEndedAbnormally", &c.sessions_ended_abnormally),
            ("rejectedTotal", &c.rejected_total),
        ] {
            m.insert(k.into(), json!(n(v)));
        }
        Value::Object(m)
    }
}
