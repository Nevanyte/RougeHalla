//! The match director: admission (protocol, content, credentials, profile ownership, capacity), room placement, session
//! resume, and the off-tick handling of what rooms report (results to durable storage with retries, freed profiles).
//! Several matches run in one process (one tokio task each); the hosting layer decides how many processes run per host.

use crate::hosting::Lifecycle;
use crate::outbox::Outbox;
use crate::persist::{Auth, Persistence};
use crate::room::{
    random16, run_room, JoinOk, MapAssets, MatchId, Room, RoomCmd, RoomConfig, RoomReport,
    RoomStats, INBOUND_CAP,
};
use rh_protocol::{RejectCode, PROTOCOL_VERSION};
use rh_sim::{Arena, FactionId, Phase, SimConfig};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, Notify};

#[derive(Clone)]
pub struct DirectorConfig {
    pub sim: SimConfig,
    /// The map every room plays on, shared (never cloned per room).
    pub arena: Arc<Arena>,
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
    pub fn new(sim: SimConfig, arena: impl Into<Arc<Arena>>) -> Self {
        Self {
            sim,
            arena: arena.into(),
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
    /// Humans the room reported seated (its `Seated` reports, less its `Left` ones).
    seated: usize,
    /// Admissions that picked this room and have not been seated yet (their durable lease may still be pending). Kept
    /// apart from `seated` so a report of the seated count can never erase them.
    reserved: usize,
}

impl RoomEntry {
    /// Humans the room has or is about to have.
    fn committed(&self) -> usize {
        self.seated + self.reserved
    }
}

/// The lobby the next admission joins: among lobbies with a free seat (counting reservations), the fullest, so matches fill
/// before another opens; ties go to the lowest id. Deterministic (no HashMap order).
fn open_lobby(rooms: &HashMap<MatchId, RoomEntry>) -> Option<MatchId> {
    rooms
        .iter()
        .filter(|(_, r)| r.phase == Phase::Lobby && r.committed() < rh_sim::constants::MAX_PLAYERS)
        .min_by_key(|(id, r)| (std::cmp::Reverse(r.committed()), **id))
        .map(|(id, _)| *id)
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
    /// The configured map and its Welcome blob, built once and lent to every room.
    map: MapAssets,
    inner: Mutex<Inner>,
    reports: mpsc::UnboundedSender<RoomReport>,
    pub persistence: Arc<Persistence>,
    pub auth: Arc<Auth>,
    pub lifecycle: Arc<Lifecycle>,
    /// Woken whenever a `leaving` profile is freed: an admission for it waits on this instead of being refused.
    freed: Notify,
}

/// How long an admission waits for a profile that is mid-release (its lease give-back is in flight) before it is refused
/// as in use. A release is milliseconds; a result write that is being retried can take minutes, and that is a refusal,
/// not a wait.
pub const LEAVING_WAIT: Duration = Duration::from_secs(3);

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
        let map = MapAssets::new(cfg.arena.clone()).expect("the arena's map encodes as a Welcome");
        let d = Arc::new(Self {
            pending_writes: std::sync::atomic::AtomicUsize::new(0),
            cfg,
            map,
            inner: Mutex::new(Inner::default()),
            reports: tx,
            persistence,
            auth,
            lifecycle,
            freed: Notify::new(),
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
        // A lobby can close into its run, or its last player can leave and the room close, between the pick and the join
        // (the room then refuses MatchFull, or its inbox is gone): that room is marked unjoinable, try another.
        let mut tries = 0;
        loop {
            match self.admit_once(&h, outbox.clone(), conn).await {
                Err((RejectCode::MatchFull, reason))
                    if (reason == "lobby closed" || reason == "match closed") && tries < 3 =>
                {
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
        // A player who just left (or whose match just closed) has its lease give-back in flight: wait for it instead of
        // refusing, so a quick rejoin is deterministic. A profile with a live seat is refused below as before.
        self.wait_while_leaving(&key, LEAVING_WAIT).await;
        // Pick (or open) a lobby, reserving the profile in the same critical section so two connections cannot both pass.
        let (match_id, tx) = {
            let mut inner = self.inner.lock().expect("director");
            if inner.profiles.contains_key(&key) {
                return Err((
                    RejectCode::ProfileInUse,
                    "callsign already in a match".into(),
                ));
            }
            let open = open_lobby(&inner.rooms)
                .and_then(|id| inner.rooms.get(&id).map(|r| (id, r.tx.clone())));
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
                        arena: self.map.arena.clone(),
                        welcome_map: self.map.welcome_map.clone(),
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
                            seated: 0,
                            reserved: 0,
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
                r.reserved += 1;
            }
            picked
        };
        let release = |this: &Self| {
            let mut inner = this.inner.lock().expect("director");
            inner.profiles.remove(&key);
            if let Some(r) = inner.rooms.get_mut(&match_id) {
                r.reserved = r.reserved.saturating_sub(1);
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
            self.mark_unjoinable(match_id);
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
                    self.mark_unjoinable(match_id);
                    return Err((code, "lobby closed".into()));
                }
                Err((code, "join refused".into()))
            }
            Err(_) => {
                release(self);
                self.release_lease(&h.profile, fence);
                self.mark_unjoinable(match_id);
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
                        room.seated = room.seated.saturating_sub(1);
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
                            d.free_leaving(&key, m);
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
                        d.free_leaving(&key, match_id);
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
                    // Seats still held by this match lose their leases (a result, if any, was already reported). Each
                    // profile stays reserved (`leaving`) until its lease is given back, like a lobby leave: a quick
                    // rejoin must not race the release.
                    let mut orphaned: Vec<(String, i64)> = Vec::new();
                    for (k, s) in inner.profiles.iter_mut() {
                        if s.match_id == match_id && !s.leaving {
                            s.leaving = true;
                            orphaned.push((k.clone(), s.fence));
                        }
                    }
                    for (k, f) in orphaned {
                        let d = this.clone();
                        tokio::spawn(async move {
                            let _ = d.persistence.release(&k, f).await;
                            d.free_leaving(&k, match_id);
                        });
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
                RoomReport::Seated {
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
                        // The admission that took this seat stops being a reservation; the others still are.
                        r.reserved = r.reserved.saturating_sub(1);
                        r.seated = humans;
                        r.phase = phase;
                    }
                }
                RoomReport::Phase { match_id, phase } => {
                    if let Some(r) = this
                        .inner
                        .lock()
                        .expect("director")
                        .rooms
                        .get_mut(&match_id)
                    {
                        r.phase = phase;
                    }
                }
            }
        }
    }

    /// Never offer this room to an admission again (its lobby ended or its task is gone; its `Closed` report removes it).
    fn mark_unjoinable(&self, match_id: MatchId) {
        if let Some(r) = self
            .inner
            .lock()
            .expect("director")
            .rooms
            .get_mut(&match_id)
        {
            r.phase = Phase::Active;
        }
    }

    /// Frees a `leaving` profile (its lease is given back or its result written) and wakes the admissions waiting for it.
    fn free_leaving(&self, key: &str, match_id: MatchId) {
        let mut inner = self.inner.lock().expect("director");
        if inner
            .profiles
            .get(key)
            .is_some_and(|s| s.leaving && s.match_id == match_id)
        {
            inner.profiles.remove(key);
        }
        drop(inner);
        self.freed.notify_waiters();
    }

    /// Waits, for at most `max`, while `key` is a `leaving` profile. Returns at once for a free profile and for one with a
    /// live seat (the caller refuses that: concurrent ownership is never weakened).
    async fn wait_while_leaving(&self, key: &str, max: Duration) {
        let deadline = tokio::time::Instant::now() + max;
        loop {
            // Register for the wake-up before looking, so a free between the look and the wait is not missed.
            let notified = self.freed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let leaving = self
                .inner
                .lock()
                .expect("director")
                .profiles
                .get(key)
                .is_some_and(|s| s.leaving);
            if !leaving || tokio::time::timeout_at(deadline, notified).await.is_err() {
                return;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(phase: Phase, seated: usize, reserved: usize) -> RoomEntry {
        RoomEntry {
            tx: mpsc::channel(1).0,
            phase,
            seated,
            reserved,
        }
    }

    fn id(n: u8) -> MatchId {
        let mut b = [0u8; 16];
        b[15] = n;
        b
    }

    fn rooms(entries: &[(u8, Phase, usize, usize)]) -> HashMap<MatchId, RoomEntry> {
        entries
            .iter()
            .map(|&(n, p, s, r)| (id(n), entry(p, s, r)))
            .collect()
    }

    #[test]
    fn the_fullest_open_lobby_is_picked_and_ties_go_to_the_lowest_id() {
        let m = rooms(&[
            (9, Phase::Lobby, 2, 0),
            (4, Phase::Lobby, 5, 0),
            (7, Phase::Lobby, 5, 0),
            (1, Phase::Lobby, 1, 0),
        ]);
        assert_eq!(
            open_lobby(&m),
            Some(id(4)),
            "fullest first, tie to the lowest id"
        );
        let m = rooms(&[(3, Phase::Lobby, 0, 0), (2, Phase::Lobby, 0, 0)]);
        assert_eq!(open_lobby(&m), Some(id(2)));
        assert_eq!(open_lobby(&HashMap::new()), None);
    }

    #[test]
    fn the_pick_does_not_depend_on_hash_map_order() {
        // The same rooms inserted in every rotation iterate differently (the map is randomly seeded per instance);
        // the pick is always the same.
        let spec = [
            (5, Phase::Lobby, 3, 1),
            (2, Phase::Lobby, 4, 0),
            (8, Phase::Active, 6, 0),
            (6, Phase::Lobby, 4, 0),
            (1, Phase::Lobby, 0, 2),
        ];
        for rot in 0..spec.len() {
            let mut s = spec.to_vec();
            s.rotate_left(rot);
            for _ in 0..8 {
                assert_eq!(open_lobby(&rooms(&s)), Some(id(2)));
            }
        }
    }

    #[test]
    fn a_lobby_counts_its_reservations_and_runs_and_full_lobbies_are_not_offered() {
        // 6 seated + 2 reserved = full: not offered although only 6 are seated; the emptier lobby is.
        let m = rooms(&[(1, Phase::Lobby, 6, 2), (2, Phase::Lobby, 1, 0)]);
        assert_eq!(open_lobby(&m), Some(id(2)));
        // A lobby that closed into its run never is, however empty.
        let m = rooms(&[(1, Phase::Active, 0, 0), (2, Phase::Ended, 0, 0)]);
        assert_eq!(open_lobby(&m), None);
        // Reservations alone make a lobby fuller than its rival.
        let m = rooms(&[(1, Phase::Lobby, 1, 0), (2, Phase::Lobby, 0, 3)]);
        assert_eq!(open_lobby(&m), Some(id(2)));
    }

    fn director() -> Arc<Director> {
        let sim = SimConfig {
            min_players: 2,
            lobby_seconds: 30.0,
            fill_seconds: 0.0,
            pvp_rules: true,
        };
        let map = rh_sim::TileMap::from_rows(&["####", "#..#", "#..#", "####"]).unwrap();
        let arena = Arena {
            map,
            spawns: vec![rh_sim::Vec2::new(48.0, 48.0)],
        };
        Director::new(
            DirectorConfig::new(sim, arena),
            Arc::new(Persistence::memory()),
            Arc::new(Auth::Dev),
            Arc::new(Lifecycle::default()),
        )
    }

    /// Lets the report loop (and anything else runnable) drain.
    async fn settle() {
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
    }

    /// A lobby whose room task already ended (its last player left) is still in the map until its `Closed` report is
    /// handled: an admission that picks it is moved to another room instead of being refused.
    #[tokio::test]
    async fn an_admission_that_picks_a_room_that_just_closed_lands_in_another() {
        let d = director();
        let dead = id(9);
        let (tx, rx) = mpsc::channel(1);
        drop(rx);
        d.inner.lock().unwrap().rooms.insert(
            dead,
            RoomEntry {
                tx,
                phase: Phase::Lobby,
                seated: 1,
                reserved: 0,
            },
        );
        let hello = Hello {
            protocol: PROTOCOL_VERSION,
            content_hash: rh_sim::content::content_hash(),
            profile: "papa".into(),
            token: String::new(),
            faction: None,
            resume: None,
        };
        let (_tx, ok) = d
            .admit(hello, Arc::new(Outbox::default()), 1)
            .await
            .expect("admitted into a fresh lobby");
        assert_ne!(ok.session, [0; 16]);
        let inner = d.inner.lock().unwrap();
        assert_eq!(
            inner.rooms[&dead].phase,
            Phase::Active,
            "never offered again"
        );
        assert_eq!(inner.rooms.len(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn an_admission_waits_for_a_leaving_profile_but_not_for_a_seated_one() {
        let d = director();
        let m = id(1);
        let seat = |leaving| ProfileSeat {
            match_id: m,
            fence: 1,
            leaving,
        };
        d.inner
            .lock()
            .unwrap()
            .profiles
            .insert("papa".into(), seat(true));
        d.inner
            .lock()
            .unwrap()
            .profiles
            .insert("quebec".into(), seat(false));
        // A live seat is not waited for: the caller refuses it.
        tokio::time::timeout(
            Duration::from_millis(1),
            d.wait_while_leaving("quebec", LEAVING_WAIT),
        )
        .await
        .expect("returns at once");
        // A leaving profile is waited for until it is freed.
        let waiter = {
            let d = d.clone();
            tokio::spawn(async move { d.wait_while_leaving("papa", LEAVING_WAIT).await })
        };
        settle().await;
        assert!(!waiter.is_finished(), "still mid-release");
        d.free_leaving("papa", m);
        waiter.await.unwrap();
        assert!(!d.inner.lock().unwrap().profiles.contains_key("papa"));
        // A release that never lands ends the wait at the bound (the caller then refuses as in use).
        d.inner
            .lock()
            .unwrap()
            .profiles
            .insert("papa".into(), seat(true));
        let t0 = tokio::time::Instant::now();
        d.wait_while_leaving("papa", LEAVING_WAIT).await;
        assert_eq!(t0.elapsed(), LEAVING_WAIT);
        // Another match's free does not free this one.
        d.free_leaving("papa", id(2));
        assert!(d.inner.lock().unwrap().profiles.contains_key("papa"));
    }

    #[tokio::test]
    async fn a_report_of_the_seated_count_never_erases_admissions_still_acquiring_their_lease() {
        let d = director();
        let m = id(1);
        // Seven admissions picked this lobby; their leases are pending: reserved, none seated.
        d.inner
            .lock()
            .unwrap()
            .rooms
            .insert(m, entry(Phase::Lobby, 0, 7));
        let committed = |d: &Director| d.inner.lock().unwrap().rooms[&m].committed();
        assert_eq!(committed(&d), 7);
        // The first of them is seated: its reservation becomes a seat, the other six stay reserved.
        d.reports
            .send(RoomReport::Seated {
                match_id: m,
                phase: Phase::Lobby,
                humans: 1,
            })
            .unwrap();
        settle().await;
        assert_eq!(committed(&d), 7, "1 seated + 6 reserved");
        assert_eq!(d.inner.lock().unwrap().rooms[&m].reserved, 6);
        // A phase report carries no count at all and changes nothing else.
        d.reports
            .send(RoomReport::Phase {
                match_id: m,
                phase: Phase::Lobby,
            })
            .unwrap();
        settle().await;
        assert_eq!(committed(&d), 7);
        // So an eighth admission still fits and the ninth is not offered this lobby.
        let mut inner = d.inner.lock().unwrap();
        assert_eq!(open_lobby(&inner.rooms), Some(m));
        inner.rooms.get_mut(&m).unwrap().reserved += 1;
        assert_eq!(open_lobby(&inner.rooms), None, "never over-offered");
    }
}
