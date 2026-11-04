//! The match director: admission (protocol, content, credentials, profile ownership, capacity), room placement, session
//! resume, and the off-tick handling of what rooms report (results to durable storage with retries, freed profiles).
//! Several matches run in one process (one tokio task each); the hosting layer decides how many processes run per host.

use crate::hosting::Lifecycle;
use crate::outbox::Outbox;
use crate::persist::{Auth, Persistence};
use crate::room::{
    random16, run_room, JoinOk, MatchId, Room, RoomCmd, RoomConfig, RoomReport, RoomStats,
    INBOUND_CAP,
};
use rh_protocol::{RejectCode, PROTOCOL_VERSION};
use rh_sim::{Arena, FactionId, Phase, SimConfig};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};

#[derive(Clone)]
pub struct DirectorConfig {
    pub sim: SimConfig,
    pub arena: Arena,
    pub max_rooms: usize,
    pub fill_bots_to: usize,
    pub tick: Duration,
    /// Record a private replay of every match (kept in memory for the last few rooms; tests and diagnostics).
    pub record: bool,
    pub reconnect_grace: Duration,
    pub linger: Duration,
    /// A connection that sends nothing for this long is treated as dropped (clients ping at least every second).
    pub idle_timeout: Duration,
}

impl DirectorConfig {
    pub fn new(sim: SimConfig, arena: Arena) -> Self {
        Self {
            sim,
            arena,
            max_rooms: 16,
            fill_bots_to: 0,
            tick: Duration::from_millis(rh_sim::constants::TICK_MS as u64),
            record: false,
            reconnect_grace: crate::room::RECONNECT_GRACE,
            linger: crate::room::LINGER,
            idle_timeout: crate::conn::IDLE_TIMEOUT,
        }
    }
}

struct RoomEntry {
    tx: mpsc::Sender<RoomCmd>,
    phase: Phase,
    humans: usize,
}

#[derive(Clone, Copy)]
struct ProfileSeat {
    match_id: MatchId,
    fence: i64,
    leaving: bool,
}

#[derive(Default)]
struct Inner {
    rooms: HashMap<MatchId, RoomEntry>,
    /// Lower-cased profile -> its seat: one live seat per profile in this process (the database lease makes it
    /// cross-host). A profile that left a run with its result still to be written stays reserved (`leaving`) until the
    /// write finishes, so it cannot take a new lease that would make that write stale.
    profiles: HashMap<String, ProfileSeat>,
    sessions: HashMap<[u8; 16], MatchId>,
    closed: Vec<RoomStats>,
    results_ok: u64,
    results_failed: u64,
    replays: Vec<rh_sim::replay::Replay>,
}

/// Attempts per result write (100 ms doubling to 5 s: about two minutes in all).
pub const RESULT_ATTEMPTS: u32 = 30;

pub struct Director {
    /// Result writes in flight (the process waits for them before exiting).
    pub pending_writes: std::sync::atomic::AtomicUsize,
    cfg: DirectorConfig,
    inner: Mutex<Inner>,
    reports: mpsc::UnboundedSender<RoomReport>,
    pub persistence: Arc<Persistence>,
    pub auth: Arc<Auth>,
    pub lifecycle: Arc<Lifecycle>,
}

pub struct Hello {
    pub protocol: u16,
    pub content_hash: u64,
    pub profile: String,
    pub token: String,
    pub faction: Option<u8>,
    pub resume: Option<[u8; 16]>,
}

fn profile_ok(p: &str) -> bool {
    (2..=16).contains(&p.len())
        && p.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

impl Director {
    pub fn new(
        cfg: DirectorConfig,
        persistence: Arc<Persistence>,
        auth: Arc<Auth>,
        lifecycle: Arc<Lifecycle>,
    ) -> Arc<Self> {
        if let Err(e) = crate::wire::arena_fits(&cfg.arena) {
            panic!("refusing to host this arena: {e}");
        }
        let (tx, rx) = mpsc::unbounded_channel();
        let d = Arc::new(Self {
            pending_writes: std::sync::atomic::AtomicUsize::new(0),
            cfg,
            inner: Mutex::new(Inner::default()),
            reports: tx,
            persistence,
            auth,
            lifecycle,
        });
        tokio::spawn(Self::report_loop(d.clone(), rx));
        d
    }

    /// Admits a connection. Every refusal is decided before a seat is taken.
    pub async fn admit(
        &self,
        h: Hello,
        outbox: Arc<Outbox>,
        conn: u64,
    ) -> Result<(mpsc::Sender<RoomCmd>, JoinOk), (RejectCode, String)> {
        // A lobby can close into its run between the pick and the join (the room then refuses MatchFull): try another.
        let mut tries = 0;
        loop {
            match self.admit_once(&h, outbox.clone(), conn).await {
                Err((RejectCode::MatchFull, reason)) if reason == "lobby closed" && tries < 2 => {
                    tries += 1
                }
                other => return other,
            }
        }
    }

    async fn admit_once(
        &self,
        h: &Hello,
        outbox: Arc<Outbox>,
        conn: u64,
    ) -> Result<(mpsc::Sender<RoomCmd>, JoinOk), (RejectCode, String)> {
        if h.protocol != PROTOCOL_VERSION {
            return Err((
                RejectCode::ProtocolMismatch,
                format!(
                    "server speaks protocol {PROTOCOL_VERSION}, client {}",
                    h.protocol
                ),
            ));
        }
        let content = rh_sim::content::content_hash();
        if h.content_hash != content {
            return Err((
                RejectCode::ContentMismatch,
                format!("server content {content:016x}"),
            ));
        }
        if let Some(session) = h.resume {
            let tx = {
                let inner = self.inner.lock().expect("director");
                inner
                    .sessions
                    .get(&session)
                    .and_then(|m| inner.rooms.get(m))
                    .map(|r| r.tx.clone())
            };
            let Some(tx) = tx else {
                return Err((RejectCode::NoSuchSession, "session expired".into()));
            };
            let (reply, rx) = oneshot::channel();
            tx.send(RoomCmd::Resume {
                session,
                outbox,
                conn,
                reply,
            })
            .await
            .map_err(|_| (RejectCode::NoSuchSession, "match over".into()))?;
            let ok = rx
                .await
                .map_err(|_| (RejectCode::NoSuchSession, "match over".into()))?
                .map_err(|c| (c, "resume refused".into()))?;
            return Ok((tx, ok));
        }
        if !profile_ok(&h.profile) {
            return Err((
                RejectCode::BadCredentials,
                "callsign must be 2-16 of A-Z a-z 0-9 _ -".into(),
            ));
        }
        if self.lifecycle.draining() {
            return Err((RejectCode::ServerDraining, "server draining".into()));
        }
        if !self.auth.verify(&h.profile, &h.token).await {
            return Err((RejectCode::BadCredentials, "bad credentials".into()));
        }
        let key = h.profile.to_ascii_lowercase();
        // Pick (or open) a lobby, reserving the profile in the same critical section so two connections cannot both pass.
        let (match_id, tx) = {
            let mut inner = self.inner.lock().expect("director");
            if inner.profiles.contains_key(&key) {
                return Err((
                    RejectCode::ProfileInUse,
                    "callsign already in a match".into(),
                ));
            }
            let open = inner
                .rooms
                .iter()
                .find(|(_, r)| r.phase == Phase::Lobby && r.humans < rh_sim::constants::MAX_PLAYERS)
                .map(|(id, r)| (*id, r.tx.clone()));
            let picked = match open {
                Some(x) => x,
                None => {
                    if inner.rooms.len() >= self.cfg.max_rooms {
                        return Err((RejectCode::MatchFull, "no capacity".into()));
                    }
                    let id = random16();
                    let (tx, rx) = mpsc::channel(INBOUND_CAP);
                    let rc = RoomConfig {
                        sim: self.cfg.sim.clone(),
                        arena: self.cfg.arena.clone(),
                        fill_bots_to: self.cfg.fill_bots_to,
                        tick: self.cfg.tick,
                        record: self.cfg.record,
                        fixed_secrets: None,
                        fixed_bot_seed: None,
                        reconnect_grace: self.cfg.reconnect_grace,
                        linger: self.cfg.linger,
                    };
                    let room = Room::new(id, rc, self.reports.clone(), tokio::time::Instant::now());
                    tokio::spawn(run_room(room, rx));
                    inner.rooms.insert(
                        id,
                        RoomEntry {
                            tx: tx.clone(),
                            phase: Phase::Lobby,
                            humans: 0,
                        },
                    );
                    (id, tx)
                }
            };
            inner.profiles.insert(
                key.clone(),
                ProfileSeat {
                    match_id: picked.0,
                    fence: 0,
                    leaving: false,
                },
            );
            if let Some(r) = inner.rooms.get_mut(&picked.0) {
                r.humans += 1;
            }
            picked
        };
        let release = |this: &Self| {
            let mut inner = this.inner.lock().expect("director");
            inner.profiles.remove(&key);
            if let Some(r) = inner.rooms.get_mut(&match_id) {
                r.humans = r.humans.saturating_sub(1);
            }
        };
        // Cross-host session ownership: a fenced lease in durable storage (off the tick; before the seat is taken).
        let fence = match self.persistence.acquire(&h.profile, match_id).await {
            Ok(f) => f,
            Err(e) => {
                release(self);
                return Err((RejectCode::ProfileInUse, e));
            }
        };
        let (reply, rx) = oneshot::channel();
        let faction = h.faction.and_then(FactionId::from_code);
        if tx
            .send(RoomCmd::Join {
                profile: h.profile.clone(),
                faction,
                outbox,
                conn,
                fence,
                reply,
            })
            .await
            .is_err()
        {
            release(self);
            self.release_lease(&h.profile, fence);
            return Err((RejectCode::MatchFull, "match closed".into()));
        }
        match rx.await {
            Ok(Ok(ok)) => {
                let mut inner = self.inner.lock().expect("director");
                inner.profiles.insert(
                    key,
                    ProfileSeat {
                        match_id,
                        fence,
                        leaving: false,
                    },
                );
                inner.sessions.insert(ok.session, match_id);
                Ok((tx, ok))
            }
            Ok(Err(code)) => {
                release(self);
                self.release_lease(&h.profile, fence);
                if code == RejectCode::MatchFull {
                    // The lobby closed into its run: never pick it again; admit() tries another room.
                    if let Some(r) = self
                        .inner
                        .lock()
                        .expect("director")
                        .rooms
                        .get_mut(&match_id)
                    {
                        r.phase = Phase::Active;
                    }
                    return Err((code, "lobby closed".into()));
                }
                Err((code, "join refused".into()))
            }
            Err(_) => {
                release(self);
                self.release_lease(&h.profile, fence);
                Err((RejectCode::MatchFull, "match closed".into()))
            }
        }
    }

    async fn report_loop(this: Arc<Self>, mut rx: mpsc::UnboundedReceiver<RoomReport>) {
        while let Some(r) = rx.recv().await {
            match r {
                RoomReport::Left {
                    profile,
                    fence,
                    result_pending,
                } => {
                    let key = profile.to_ascii_lowercase();
                    let mut inner = this.inner.lock().expect("director");
                    let Some(seat) = inner.profiles.get(&key).copied() else {
                        continue;
                    };
                    if let Some(room) = inner.rooms.get_mut(&seat.match_id) {
                        room.humans = room.humans.saturating_sub(1);
                    }
                    // The profile stays reserved (`leaving`) until its result is written (Result below) or, with no result
                    // to come, until its lease is released: a quick rejoin must not race the durable lease.
                    if let Some(s) = inner.profiles.get_mut(&key) {
                        s.leaving = true;
                    }
                    drop(inner);
                    if !result_pending {
                        let d = this.clone();
                        let m = seat.match_id;
                        tokio::spawn(async move {
                            let _ = d.persistence.release(&profile, fence).await;
                            let mut inner = d.inner.lock().expect("director");
                            if inner
                                .profiles
                                .get(&key)
                                .is_some_and(|s| s.leaving && s.match_id == m)
                            {
                                inner.profiles.remove(&key);
                            }
                        });
                    }
                }
                RoomReport::Result {
                    match_id,
                    profile,
                    bot,
                    fence,
                    result,
                } => {
                    if bot {
                        continue; // bots never touch persistence (legacy rule)
                    }
                    let key = profile.to_ascii_lowercase();
                    let fence = fence
                        .or_else(|| {
                            this.inner
                                .lock()
                                .expect("director")
                                .profiles
                                .get(&key)
                                .map(|s| s.fence)
                        })
                        .unwrap_or(0);
                    let d = this.clone();
                    // Durable I/O never runs on a room task: retried here with capped backoff for about two minutes
                    // (a database blip must not lose a result), idempotent by (match, profile); the process waits for
                    // in-flight writes before exiting (main.rs, `wait_for_writes`).
                    d.pending_writes
                        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    tokio::spawn(async move {
                        let mut delay = Duration::from_millis(100);
                        for attempt in 0..RESULT_ATTEMPTS {
                            match d
                                .persistence
                                .record(match_id, &profile, fence, &result)
                                .await
                            {
                                Ok(_) => {
                                    d.inner.lock().expect("director").results_ok += 1;
                                    break;
                                }
                                Err(e) if attempt == RESULT_ATTEMPTS - 1 => {
                                    eprintln!("[results] giving up on {profile}: {e}");
                                    d.inner.lock().expect("director").results_failed += 1;
                                }
                                Err(_) => {
                                    tokio::time::sleep(delay).await;
                                    delay = (delay * 2).min(Duration::from_secs(5));
                                }
                            }
                        }
                        // A profile that left with this result pending is free once it is written (the store released
                        // its lease in the same transaction).
                        let mut inner = d.inner.lock().expect("director");
                        if inner
                            .profiles
                            .get(&key)
                            .is_some_and(|s| s.leaving && s.match_id == match_id)
                        {
                            inner.profiles.remove(&key);
                        }
                        drop(inner);
                        d.pending_writes
                            .fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                    });
                }
                RoomReport::Closed {
                    match_id,
                    stats,
                    replay,
                    ..
                } => {
                    let mut inner = this.inner.lock().expect("director");
                    inner.rooms.remove(&match_id);
                    inner.sessions.retain(|_, m| *m != match_id);
                    // Seats still held by this match lose their leases (a result, if any, was already reported).
                    let orphaned: Vec<(String, i64)> = inner
                        .profiles
                        .iter()
                        .filter(|(_, s)| s.match_id == match_id && !s.leaving)
                        .map(|(k, s)| (k.clone(), s.fence))
                        .collect();
                    inner
                        .profiles
                        .retain(|_, s| s.match_id != match_id || s.leaving);
                    for (k, f) in orphaned {
                        this.release_lease(&k, f);
                    }
                    inner.closed.push(stats);
                    if inner.closed.len() > 64 {
                        inner.closed.remove(0);
                    }
                    if let Some(r) = replay {
                        inner.replays.push(*r);
                        if inner.replays.len() > 4 {
                            inner.replays.remove(0);
                        }
                    }
                    let empty = inner.rooms.is_empty();
                    drop(inner);
                    if empty {
                        this.lifecycle.rooms_empty();
                    }
                }
                RoomReport::Phase {
                    match_id,
                    phase,
                    humans,
                } => {
                    if let Some(r) = this
                        .inner
                        .lock()
                        .expect("director")
                        .rooms
                        .get_mut(&match_id)
                    {
                        r.phase = phase;
                        r.humans = humans;
                    }
                }
            }
        }
    }

    /// Releases a profile's session lease off the task that asked (no-op in memory). Best effort: an unreleased lease only
    /// expires later.
    fn release_lease(&self, profile: &str, fence: i64) {
        let p = self.persistence.clone();
        let profile = profile.to_string();
        tokio::spawn(async move {
            let _ = p.release(&profile, fence).await;
        });
    }

    /// Stop admitting; active matches finish; the lifecycle reports Terminated when the last room closes.
    pub async fn drain(&self) {
        self.lifecycle.start_draining();
        let txs: Vec<_> = self
            .inner
            .lock()
            .expect("director")
            .rooms
            .values()
            .map(|r| r.tx.clone())
            .collect();
        if txs.is_empty() {
            self.lifecycle.rooms_empty();
        }
        for tx in txs {
            let _ = tx.send(RoomCmd::Drain).await;
        }
    }

    pub fn info(&self) -> serde_json::Value {
        let inner = self.inner.lock().expect("director");
        let lobbies = inner
            .rooms
            .values()
            .filter(|r| r.phase == Phase::Lobby)
            .count();
        serde_json::json!({
            "protocol": PROTOCOL_VERSION,
            "contentHash": format!("{:016x}", rh_sim::content::content_hash()),
            "rooms": inner.rooms.len(),
            "lobbies": lobbies,
            "maxRooms": self.cfg.max_rooms,
            "players": inner.profiles.len(),
            "state": self.lifecycle.state_name(),
            "resultsOk": inner.results_ok,
            "resultsFailed": inner.results_failed,
            "closedRooms": inner.closed.iter().rev().take(8).collect::<Vec<_>>(),
        })
    }

    /// Recorded replays of the last closed rooms (private: they hold match secrets).
    pub fn take_replays(&self) -> Vec<rh_sim::replay::Replay> {
        std::mem::take(&mut self.inner.lock().expect("director").replays)
    }

    /// Waits (at most `max`) until no result write is in flight. Called before the process exits.
    pub async fn wait_for_writes(&self, max: Duration) -> bool {
        let t0 = tokio::time::Instant::now();
        while self
            .pending_writes
            .load(std::sync::atomic::Ordering::SeqCst)
            > 0
        {
            if t0.elapsed() >= max {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        true
    }

    pub fn idle_timeout(&self) -> Duration {
        self.cfg.idle_timeout
    }

    pub fn room_count(&self) -> usize {
        self.inner.lock().expect("director").rooms.len()
    }
}
