//! The match director: admission (protocol, content, credentials, profile ownership, capacity), room placement, session
//! resume, and the off-tick handling of what rooms report (results to durable storage with retries, freed profiles).
//! Several matches run in one process (one tokio task each); the hosting layer decides how many processes run per host.

use crate::hosting::Lifecycle;
use crate::outbox::Outbox;
use crate::persist::{Auth, Persistence, RecordError, Recorded};
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

/// Where a profile's entry is in its life. Every entry has exactly one owner at a time, and only that owner moves it on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SeatState {
    /// An admission (the entry's `gen`) picked `match_id` and may still be acquiring the lease or waiting for the Join
    /// reply. Only that admission changes it: a seat makes it `Seated`, a failure `Leaving` (with its give-back). A
    /// room's `Closed` never touches it (the admission unwinds itself).
    Reserved,
    /// Seated in `match_id` under `fence`. Only the room's reports for that seat (`Left`, or `Closed` after a crash)
    /// change it.
    Seated,
    /// Gone from its seat. Removed once no result is due or in flight for it and its lease is given back (by the
    /// director, or by the result write's own transaction). An admission for the profile waits for that (bounded by
    /// `LEAVING_WAIT`) instead of racing the durable lease.
    Leaving,
}

/// What this process knows of the durable lease an entry holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LeaseState {
    /// Held (or not taken yet: fence 0).
    Held,
    /// The director's give-back is in flight; its completion frees the entry.
    Releasing,
    /// Released by a result write's transaction (or refused as no longer ours): nothing to give back.
    Gone,
}

#[derive(Clone, Copy, Debug)]
struct ProfileSeat {
    /// Owner token, unique per admission. Every deferred change (a lease give-back, a result write, the admission's own
    /// unwinding) names the entry by it, so it can never remove or mark an entry a newer admission created for the same
    /// profile.
    gen: u64,
    match_id: MatchId,
    /// The lease fence (0 until the admission's acquire returns).
    fence: i64,
    state: SeatState,
    /// The seat left a run it was still standing in: its (MIA) result report is still to come.
    result_due: bool,
    /// Result writes in flight for this seat. Each releases the lease in its own transaction, so the director never
    /// gives the lease back while one is in flight: a give-back that landed first would make the write fail `NoLease`.
    writes: u32,
    lease: LeaseState,
}

/// C-PERSIST, in-process ownership (the durable lease fences across hosts):
///
/// * One entry per profile (lower-cased). While it exists, an admission for that profile is refused `ProfileInUse`, or,
///   if the entry is `Leaving`, waits for it to go (at most `LEAVING_WAIT` for the whole admission, then refused). So a
///   profile never has two live seats in this process, and a new lease is never taken while the old one may still be
///   given back or written to.
/// * An entry is created only by an admission (`Reserved`, under a fresh `gen`) and removed only by its owner: the
///   admission's own unwinding, or the give-back / result write of the seat it became, each naming the `gen`.
/// * The lease of a seat that left is given back only once no result is due or in flight for it; a write that lands
///   releases the lease itself.
#[derive(Default)]
struct Inner {
    rooms: HashMap<MatchId, RoomEntry>,
    profiles: HashMap<String, ProfileSeat>,
    /// The last `ProfileSeat::gen` handed out.
    gens: u64,
    sessions: HashMap<[u8; 16], MatchId>,
    closed: Vec<RoomStats>,
    results_ok: u64,
    results_failed: u64,
    /// Results the store refused for good (no lease, stale fence): not retried.
    results_refused: u64,
    replays: Vec<rh_sim::replay::Replay>,
}

/// Attempts per result write (100 ms doubling to 5 s: about two minutes in all). Only transient errors are retried.
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
    /// This director, for the tasks it spawns (lease give-backs) from `&self`.
    me: std::sync::Weak<Director>,
}

/// How long an admission waits, in all (one deadline shared by its retries), for a profile that is mid-release (its lease
/// give-back or result write is in flight) before it is refused as in use. A release is milliseconds; a result write that
/// is being retried can take minutes, and that is a refusal, not a wait.
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
        let d = Arc::new_cyclic(|me| Self {
            pending_writes: std::sync::atomic::AtomicUsize::new(0),
            cfg,
            map,
            inner: Mutex::new(Inner::default()),
            reports: tx,
            persistence,
            auth,
            lifecycle,
            freed: Notify::new(),
            me: me.clone(),
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
        // (the room then refuses MatchFull, or its inbox is gone): that room is marked unjoinable, try another. Every
        // attempt shares one deadline for waiting on a profile mid-release, so the documented bound is the real one.
        let deadline = tokio::time::Instant::now() + LEAVING_WAIT;
        let mut tries = 0;
        loop {
            match self.admit_once(&h, outbox.clone(), conn, deadline).await {
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
        deadline: tokio::time::Instant,
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
        // A player who just left (or whose match just closed, or whose previous attempt here just failed) has its lease
        // give-back in flight: wait for it instead of refusing, so a quick rejoin is deterministic. A profile with a live
        // seat, or with another admission in flight, is refused below as before.
        self.wait_while_leaving(&key, deadline).await;
        // Pick (or open) a lobby, reserving the profile in the same critical section so two connections cannot both pass.
        let (match_id, tx, gen) = {
            let mut inner = self.inner.lock().expect("director");
            if inner.profiles.contains_key(&key) {
                return Err((
                    RejectCode::ProfileInUse,
                    "callsign already in a match".into(),
                ));
            }
            let open = open_lobby(&inner.rooms)
                .and_then(|id| inner.rooms.get(&id).map(|r| (id, r.tx.clone())));
            let (match_id, tx) = match open {
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
                    // A panic in the room still reports `Closed` (room.rs `run_room`), so its seats are freed.
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
            inner.gens += 1;
            let gen = inner.gens;
            inner.profiles.insert(
                key.clone(),
                ProfileSeat {
                    gen,
                    match_id,
                    fence: 0,
                    state: SeatState::Reserved,
                    result_due: false,
                    writes: 0,
                    lease: LeaseState::Held,
                },
            );
            if let Some(r) = inner.rooms.get_mut(&match_id) {
                r.reserved += 1;
            }
            (match_id, tx, gen)
        };
        // Cross-host session ownership: a fenced lease in durable storage (off the tick; before the seat is taken).
        let fence = match self.persistence.acquire(&h.profile, match_id).await {
            Ok(f) => f,
            Err(e) => {
                self.unwind(&key, gen, match_id, None);
                return Err((RejectCode::ProfileInUse, e));
            }
        };
        if let Some(s) = self.inner.lock().expect("director").profiles.get_mut(&key) {
            if s.gen == gen {
                s.fence = fence;
            }
        }
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
            // The room is gone. The retry (admit) waits for this give-back: the entry stays `Leaving` until it lands.
            self.unwind(&key, gen, match_id, Some(fence));
            self.mark_unjoinable(match_id);
            return Err((RejectCode::MatchFull, "match closed".into()));
        }
        match rx.await {
            Ok(Ok(ok)) => {
                let mut inner = self.inner.lock().expect("director");
                let room_gone = !inner.rooms.contains_key(&match_id);
                let mut orphaned = false;
                if let Some(s) = inner.profiles.get_mut(&key).filter(|s| s.gen == gen) {
                    if s.state == SeatState::Reserved {
                        // The room crashed after seating us and its `Closed` (which skips reservations) is already
                        // handled: nothing else would free this seat.
                        orphaned = room_gone;
                        s.state = if room_gone {
                            SeatState::Leaving
                        } else {
                            SeatState::Seated
                        };
                    }
                    // Otherwise the seat's `Left` was handled before this reply: the entry is `Leaving` and its own
                    // give-back frees it.
                }
                if orphaned {
                    self.advance(&mut inner, &key);
                }
                // A room that already closed has had its sessions swept: nothing would ever remove this one.
                if !room_gone {
                    inner.sessions.insert(ok.session, match_id);
                }
                Ok((tx, ok))
            }
            Ok(Err(code)) => {
                self.unwind(&key, gen, match_id, Some(fence));
                if code == RejectCode::MatchFull {
                    // The lobby closed into its run: never pick it again; admit() tries another room.
                    self.mark_unjoinable(match_id);
                    return Err((code, "lobby closed".into()));
                }
                Err((code, "join refused".into()))
            }
            Err(_) => {
                self.unwind(&key, gen, match_id, Some(fence));
                self.mark_unjoinable(match_id);
                Err((RejectCode::MatchFull, "match closed".into()))
            }
        }
    }

    /// Unwinds an admission that took no seat: its room reservation goes, and its own entry (`gen`) is removed at once when
    /// no lease was taken, or stays `Leaving` until the lease give-back lands (so a retry, or another connection for the
    /// profile, waits for the give-back instead of racing it).
    fn unwind(&self, key: &str, gen: u64, match_id: MatchId, fence: Option<i64>) {
        let mut inner = self.inner.lock().expect("director");
        if let Some(r) = inner.rooms.get_mut(&match_id) {
            r.reserved = r.reserved.saturating_sub(1);
        }
        let own = inner.profiles.get(key).is_some_and(|s| s.gen == gen);
        match fence {
            None => {
                if own {
                    inner.profiles.remove(key);
                    drop(inner);
                    self.freed.notify_waiters();
                }
            }
            Some(fence) => {
                if let Some(s) = inner.profiles.get_mut(key).filter(|s| s.gen == gen) {
                    s.state = SeatState::Leaving;
                    s.lease = LeaseState::Releasing;
                }
                drop(inner);
                self.give_back(key, fence, own.then_some(gen));
            }
        }
    }

    /// Moves a `Leaving` entry on (the lock is held): nothing while a result is due or a write is in flight (the write
    /// releases the lease itself); then the lease is given back unless a write already released it, and the entry is
    /// freed when that lands.
    fn advance(&self, inner: &mut Inner, key: &str) {
        let Some(s) = inner.profiles.get_mut(key) else {
            return;
        };
        if s.state != SeatState::Leaving || s.result_due || s.writes > 0 {
            return;
        }
        match s.lease {
            LeaseState::Held => {
                s.lease = LeaseState::Releasing;
                let (fence, gen) = (s.fence, s.gen);
                self.give_back(key, fence, Some(gen));
            }
            LeaseState::Gone => {
                inner.profiles.remove(key);
                self.freed.notify_waiters();
            }
            LeaseState::Releasing => {}
        }
    }

    /// Gives a lease back off the asking task (no-op in memory), then tells `owner`'s entry (if it is still that entry).
    /// Best effort: an unreleased lease only expires later. Releasing by fence is harmless when the lease moved on.
    fn give_back(&self, key: &str, fence: i64, owner: Option<u64>) {
        let Some(d) = self.me.upgrade() else {
            return;
        };
        let key = key.to_string();
        tokio::spawn(async move {
            let _ = d.persistence.release(&key, fence).await;
            if let Some(gen) = owner {
                d.free(&key, gen);
            }
        });
    }

    async fn report_loop(this: Arc<Self>, mut rx: mpsc::UnboundedReceiver<RoomReport>) {
        while let Some(r) = rx.recv().await {
            match r {
                RoomReport::Left {
                    match_id,
                    profile,
                    fence,
                    result_pending,
                } => {
                    let key = profile.to_ascii_lowercase();
                    let mut inner = this.inner.lock().expect("director");
                    let seat = inner
                        .profiles
                        .get(&key)
                        .filter(|s| s.match_id == match_id && s.fence == fence)
                        .map(|s| s.state);
                    match seat {
                        // This seat is already being let go (cannot happen twice; ignored rather than released twice).
                        Some(SeatState::Leaving) => {}
                        Some(_) => {
                            if let Some(room) = inner.rooms.get_mut(&match_id) {
                                room.seated = room.seated.saturating_sub(1);
                            }
                            if let Some(s) = inner.profiles.get_mut(&key) {
                                // The profile stays reserved (`Leaving`) until its result is written or, with no result
                                // to come or in flight, until its lease is given back: a quick rejoin must not race the
                                // durable lease.
                                s.state = SeatState::Leaving;
                                s.result_due = result_pending;
                            }
                            this.advance(&mut inner, &key);
                        }
                        // No entry for this seat (never recorded, or another seat's): the fenced give-back is still owed,
                        // and it cannot touch a newer lease.
                        None => {
                            drop(inner);
                            this.give_back(&key, fence, None);
                        }
                    }
                }
                RoomReport::Result {
                    match_id,
                    profile,
                    bot,
                    fence,
                    result,
                    roster,
                } => {
                    if bot {
                        continue; // bots never touch persistence (legacy rule)
                    }
                    let key = profile.to_ascii_lowercase();
                    // The seat it belongs to counts the write as in flight: its lease is not given back meanwhile.
                    let (fence, owner) = {
                        let mut inner = this.inner.lock().expect("director");
                        match inner.profiles.get_mut(&key).filter(|s| {
                            s.match_id == match_id && fence.is_none_or(|f| f == s.fence)
                        }) {
                            Some(s) => {
                                s.writes += 1;
                                s.result_due = false;
                                (s.fence, Some(s.gen))
                            }
                            None => (fence.unwrap_or(0), None),
                        }
                    };
                    let d = this.clone();
                    // Durable I/O never runs on a room task: retried here with capped backoff for about two minutes
                    // (a database blip must not lose a result), idempotent by (match, profile); the process waits for
                    // in-flight writes before exiting (main.rs, `wait_for_writes`). A refusal for good is not retried.
                    d.pending_writes
                        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    tokio::spawn(async move {
                        let mut delay = Duration::from_millis(100);
                        // Whether the lease is gone after the write: released by its transaction, or no longer ours.
                        let mut lease_gone = false;
                        for attempt in 0..RESULT_ATTEMPTS {
                            match d
                                .persistence
                                .record(match_id, &profile, fence, &result, roster)
                                .await
                            {
                                Ok(Recorded::Applied) => {
                                    d.inner.lock().expect("director").results_ok += 1;
                                    lease_gone = true;
                                    break;
                                }
                                // A duplicate report: the store answers before it looks at the lease, so the lease the
                                // caller holds (if any) is still live. It is not marked gone: the seat's ordinary
                                // fenced give-back releases it (a no-op when the lease already moved on).
                                Ok(Recorded::AlreadyApplied) => {
                                    d.inner.lock().expect("director").results_ok += 1;
                                    break;
                                }
                                Err(RecordError::Refused(e)) => {
                                    eprintln!("[results] {profile}: refused by the store, not retried: {e}");
                                    d.inner.lock().expect("director").results_refused += 1;
                                    lease_gone = true;
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
                        let mut inner = d.inner.lock().expect("director");
                        match owner {
                            Some(gen) => {
                                let mut mine = false;
                                if let Some(s) =
                                    inner.profiles.get_mut(&key).filter(|s| s.gen == gen)
                                {
                                    s.writes -= 1;
                                    if lease_gone && s.lease == LeaseState::Held {
                                        s.lease = LeaseState::Gone;
                                    }
                                    mine = true;
                                }
                                // A profile that left is free once this lands (and gives its lease back first if the
                                // write gave up).
                                if mine {
                                    d.advance(&mut inner, &key);
                                }
                            }
                            None if !lease_gone => {
                                drop(inner);
                                d.give_back(&key, fence, None);
                            }
                            None => {}
                        }
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
                    // A room that closed normally reported every result and every seat's `Left` before this. A crashed
                    // one did not: its seats are let go here, and a result it still owed will never come. Reservations
                    // are their admissions' to unwind (an admission whose reply arrives after this finds the room gone).
                    let mut moved: Vec<String> = Vec::new();
                    for (k, s) in inner.profiles.iter_mut() {
                        if s.match_id != match_id {
                            continue;
                        }
                        match s.state {
                            SeatState::Reserved => {}
                            SeatState::Seated => {
                                s.state = SeatState::Leaving;
                                moved.push(k.clone());
                            }
                            SeatState::Leaving if s.result_due => {
                                s.result_due = false;
                                moved.push(k.clone());
                            }
                            SeatState::Leaving => {}
                        }
                    }
                    for k in moved {
                        this.advance(&mut inner, &k);
                    }
                    if stats.crashed {
                        eprintln!("[director] a room crashed; its seats were freed");
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

    /// A give-back for `gen`'s entry landed: its lease is gone, and the entry is freed (and the admissions waiting for the
    /// profile woken) once nothing else is pending for it: never while a result write is still in flight. An entry a newer
    /// admission owns is not touched.
    fn free(&self, key: &str, gen: u64) {
        let mut inner = self.inner.lock().expect("director");
        let mine = match inner.profiles.get_mut(key) {
            Some(s) if s.gen == gen => {
                s.lease = LeaseState::Gone;
                true
            }
            _ => false,
        };
        if mine {
            self.advance(&mut inner, key);
        }
        drop(inner);
        self.freed.notify_waiters();
    }

    /// Waits, until `deadline` at the latest, while `key` is a `Leaving` profile. Returns at once for a free profile and
    /// for one with a live seat or an admission in flight (the caller refuses those: concurrent ownership is never
    /// weakened).
    async fn wait_while_leaving(&self, key: &str, deadline: tokio::time::Instant) {
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
                .is_some_and(|s| s.state == SeatState::Leaving);
            if !leaving || tokio::time::timeout_at(deadline, notified).await.is_err() {
                return;
            }
        }
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
            "resultsRefused": inner.results_refused,
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
    use crate::persist::MemoryStore;
    use crate::room::Roster;

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

    fn director_with(store: MemoryStore) -> Arc<Director> {
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
            Arc::new(Persistence::Memory(Box::new(store))),
            Arc::new(Auth::Dev),
            Arc::new(Lifecycle::default()),
        )
    }

    fn director() -> Arc<Director> {
        director_with(MemoryStore::default())
    }

    fn store(d: &Director) -> &MemoryStore {
        match &*d.persistence {
            Persistence::Memory(m) => m,
            #[allow(unreachable_patterns)]
            _ => unreachable!(),
        }
    }

    fn hello(profile: &str) -> Hello {
        Hello {
            protocol: PROTOCOL_VERSION,
            content_hash: rh_sim::content::content_hash(),
            profile: profile.into(),
            token: String::new(),
            faction: None,
            resume: None,
        }
    }

    /// A lobby whose task is gone (its inbox is closed) but whose `Closed` report has not been handled yet.
    fn dead_lobby(d: &Director, m: MatchId, seated: usize) {
        let (tx, rx) = mpsc::channel(1);
        drop(rx);
        d.inner.lock().unwrap().rooms.insert(
            m,
            RoomEntry {
                tx,
                phase: Phase::Lobby,
                seated,
                reserved: 0,
            },
        );
    }

    fn seat(gen: u64, match_id: MatchId, fence: i64, state: SeatState) -> ProfileSeat {
        ProfileSeat {
            gen,
            match_id,
            fence,
            state,
            result_due: false,
            writes: 0,
            lease: LeaseState::Held,
        }
    }

    fn entry_of(d: &Director, key: &str) -> Option<ProfileSeat> {
        d.inner.lock().unwrap().profiles.get(key).copied()
    }

    fn some_result(profile: &str) -> rh_sim::RunResult {
        rh_sim::RunResult {
            outcome: rh_sim::Outcome::Mia,
            profile: profile.into(),
            duration_sec: 1,
            kills: 0,
            killed_by: None,
            killed_by_bot: false,
            place: 2,
            players: 2,
            gv: Default::default(),
            win_bonus_withheld: false,
            win_bonus_why: None,
        }
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
        dead_lobby(&d, dead, 1);
        let (_tx, ok) = d
            .admit(hello("papa"), Arc::new(Outbox::default()), 1)
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

    /// The dead-lobby retry takes its new lease only after the failed attempt's give-back landed. With durable lease rules
    /// (a live lease of another match refuses the acquire) and a give-back that takes a round trip, the retry used to race
    /// it and refuse a free player `ProfileInUse`; deterministic on this single-threaded runtime.
    #[tokio::test(start_paused = true)]
    async fn a_dead_lobby_retry_waits_for_its_own_lease_give_back() {
        for delay in [Duration::ZERO, Duration::from_millis(40)] {
            let d = director_with(MemoryStore {
                release_delay: delay,
                ..MemoryStore::strict()
            });
            let dead = id(9);
            dead_lobby(&d, dead, 1);
            let t0 = tokio::time::Instant::now();
            let (_tx, ok) = d
                .admit(hello("papa"), Arc::new(Outbox::default()), 1)
                .await
                .expect("a free player is admitted, never refused ProfileInUse");
            assert_eq!(t0.elapsed(), delay, "it waited exactly for the give-back");
            let lease = store(&d).lease("papa").expect("leased");
            assert_eq!(
                lease.fence, 2,
                "the dead lobby's lease (1) was given back first"
            );
            assert!(!lease.released);
            assert_ne!(lease.match_id, dead);
            let e = entry_of(&d, "papa").expect("seated");
            assert_eq!(e.state, SeatState::Seated);
            assert_eq!((e.fence, e.match_id), (2, lease.match_id));
            drop(ok);
        }
    }

    /// LEAVING_WAIT bounds the whole admission, not each retry: with give-backs that take 2 s and two dead lobbies, the
    /// second wait ends at the shared deadline (3 s after the admission began), not 2 s later.
    #[tokio::test(start_paused = true)]
    async fn leaving_wait_is_one_deadline_for_the_whole_admission() {
        let d = director_with(MemoryStore {
            release_delay: Duration::from_secs(2),
            ..MemoryStore::strict()
        });
        dead_lobby(&d, id(9), 3);
        dead_lobby(&d, id(8), 2);
        dead_lobby(&d, id(7), 1);
        let t0 = tokio::time::Instant::now();
        let r = d.admit(hello("papa"), Arc::new(Outbox::default()), 1).await;
        assert!(
            matches!(r, Err((RejectCode::ProfileInUse, _))),
            "refused at the bound"
        );
        assert_eq!(
            t0.elapsed(),
            LEAVING_WAIT,
            "the real bound is the documented one"
        );
        // The second dead lobby's give-back still lands and frees the entry it owns.
        tokio::time::sleep(Duration::from_secs(2)).await;
        settle().await;
        assert!(entry_of(&d, "papa").is_none());
        assert!(store(&d).lease("papa").expect("row").released);
    }

    #[tokio::test(start_paused = true)]
    async fn an_admission_waits_for_a_leaving_profile_but_not_for_a_seated_one() {
        let d = director();
        let m = id(1);
        d.inner
            .lock()
            .unwrap()
            .profiles
            .insert("papa".into(), seat(1, m, 1, SeatState::Leaving));
        d.inner
            .lock()
            .unwrap()
            .profiles
            .insert("quebec".into(), seat(2, m, 1, SeatState::Seated));
        d.inner
            .lock()
            .unwrap()
            .profiles
            .insert("romeo".into(), seat(3, m, 0, SeatState::Reserved));
        let soon = || tokio::time::Instant::now() + LEAVING_WAIT;
        // A live seat, or another admission in flight, is not waited for: the caller refuses it.
        for k in ["quebec", "romeo"] {
            tokio::time::timeout(Duration::from_millis(1), d.wait_while_leaving(k, soon()))
                .await
                .expect("returns at once");
        }
        // A leaving profile is waited for until it is freed.
        let waiter = {
            let d = d.clone();
            let deadline = soon();
            tokio::spawn(async move { d.wait_while_leaving("papa", deadline).await })
        };
        settle().await;
        assert!(!waiter.is_finished(), "still mid-release");
        d.free("papa", 1);
        waiter.await.unwrap();
        assert!(entry_of(&d, "papa").is_none());
        // A release that never lands ends the wait at the bound (the caller then refuses as in use).
        d.inner
            .lock()
            .unwrap()
            .profiles
            .insert("papa".into(), seat(4, m, 1, SeatState::Leaving));
        let t0 = tokio::time::Instant::now();
        d.wait_while_leaving("papa", soon()).await;
        assert_eq!(t0.elapsed(), LEAVING_WAIT);
        // Another owner's free does not free this entry.
        d.free("papa", 1);
        assert!(entry_of(&d, "papa").is_some());
    }

    /// A seat whose result was reported but not yet written leaves (it died, then left, or the match ended and lingered
    /// out): its lease is not given back in parallel with the write, which would make the write fail `NoLease` and lose
    /// the result. The write releases the lease itself, and the profile is free once it lands.
    #[tokio::test(start_paused = true)]
    async fn a_seat_with_a_result_in_flight_keeps_its_lease_until_the_write_lands() {
        let d = director_with(MemoryStore {
            record_delay: Duration::from_millis(500),
            ..MemoryStore::strict()
        });
        let m = id(1);
        let fence = d.persistence.acquire("papa", m).await.unwrap();
        d.inner
            .lock()
            .unwrap()
            .profiles
            .insert("papa".into(), seat(7, m, fence, SeatState::Seated));
        d.reports
            .send(RoomReport::Result {
                match_id: m,
                profile: "papa".into(),
                bot: false,
                fence: Some(fence),
                result: some_result("papa"),
                roster: Roster::default(),
            })
            .unwrap();
        d.reports
            .send(RoomReport::Left {
                match_id: m,
                profile: "papa".into(),
                fence,
                result_pending: false,
            })
            .unwrap();
        settle().await;
        let e = entry_of(&d, "papa").expect("held while the write is in flight");
        assert_eq!(
            (e.state, e.writes, e.lease),
            (SeatState::Leaving, 1, LeaseState::Held)
        );
        assert!(
            !store(&d).lease("papa").unwrap().released,
            "not given back early"
        );
        tokio::time::sleep(Duration::from_millis(500)).await;
        settle().await;
        assert_eq!(
            store(&d).results.lock().unwrap().len(),
            1,
            "the result landed"
        );
        let inner = d.inner.lock().unwrap();
        assert_eq!(
            (
                inner.results_ok,
                inner.results_refused,
                inner.results_failed
            ),
            (1, 0, 0)
        );
        assert!(!inner.profiles.contains_key("papa"), "free once written");
        drop(inner);
        assert!(
            store(&d).lease("papa").unwrap().released,
            "released by the write"
        );
    }

    /// Even if a result report arrived after its seat's give-back started (no room sends that order, but the bookkeeping
    /// must not depend on it), the entry is not freed while the write is in flight.
    #[tokio::test(start_paused = true)]
    async fn a_give_back_never_frees_an_entry_with_a_write_in_flight() {
        let d = director_with(MemoryStore {
            record_delay: Duration::from_millis(300),
            ..MemoryStore::strict()
        });
        let m = id(1);
        d.inner.lock().unwrap().profiles.insert(
            "papa".into(),
            ProfileSeat {
                writes: 1,
                lease: LeaseState::Releasing,
                ..seat(6, m, 1, SeatState::Leaving)
            },
        );
        d.free("papa", 6);
        let e = entry_of(&d, "papa").expect("kept while the write is in flight");
        assert_eq!((e.writes, e.lease), (1, LeaseState::Gone));
        d.inner
            .lock()
            .unwrap()
            .profiles
            .get_mut("papa")
            .unwrap()
            .writes = 0;
        d.free("papa", 6);
        assert!(
            entry_of(&d, "papa").is_none(),
            "free once nothing is pending"
        );
    }

    /// A refusal for good (no lease, stale fence) is not retried for two minutes: the profile is free at once.
    #[tokio::test(start_paused = true)]
    async fn a_result_the_store_refuses_for_good_is_not_retried() {
        let d = director_with(MemoryStore::strict());
        let m = id(1);
        let fence = d.persistence.acquire("papa", m).await.unwrap();
        // Someone else took over (a newer fence): this write can never land.
        assert!(d.persistence.release("papa", fence).await.unwrap());
        let newer = d.persistence.acquire("papa", id(2)).await.unwrap();
        assert_eq!(newer, fence + 1);
        d.inner
            .lock()
            .unwrap()
            .profiles
            .insert("papa".into(), seat(3, m, fence, SeatState::Seated));
        d.reports
            .send(RoomReport::Left {
                match_id: m,
                profile: "papa".into(),
                fence,
                result_pending: true,
            })
            .unwrap();
        d.reports
            .send(RoomReport::Result {
                match_id: m,
                profile: "papa".into(),
                bot: false,
                fence: Some(fence),
                result: some_result("papa"),
                roster: Roster::default(),
            })
            .unwrap();
        let t0 = tokio::time::Instant::now();
        settle().await;
        assert_eq!(t0.elapsed(), Duration::ZERO, "no backoff");
        let inner = d.inner.lock().unwrap();
        assert_eq!(
            (
                inner.results_ok,
                inner.results_refused,
                inner.results_failed
            ),
            (0, 1, 0)
        );
        assert!(!inner.profiles.contains_key("papa"), "free at once");
        drop(inner);
        let lease = store(&d).lease("papa").unwrap();
        assert_eq!(
            (lease.fence, lease.released),
            (newer, false),
            "the newer lease is untouched"
        );
    }

    /// Ownership is tied to the admission that owns the entry: a room's `Closed` never marks or frees a reservation still
    /// acquiring, a stale owner's unwind or free never removes a newer entry, and a `Left` with no entry of its own still
    /// gives its fenced lease back.
    #[tokio::test(start_paused = true)]
    async fn profile_entries_are_changed_only_by_their_owner() {
        let d = director_with(MemoryStore::strict());
        let m = id(1);
        d.inner
            .lock()
            .unwrap()
            .rooms
            .insert(m, entry(Phase::Lobby, 0, 1));
        d.inner
            .lock()
            .unwrap()
            .profiles
            .insert("papa".into(), seat(5, m, 0, SeatState::Reserved));
        // The room closes while the admission is mid-acquire: the reservation is its admission's to unwind.
        d.reports
            .send(RoomReport::Closed {
                match_id: m,
                stats: RoomStats::default(),
                final_hash: 0,
                replay: None,
            })
            .unwrap();
        settle().await;
        let e = entry_of(&d, "papa").expect("kept");
        assert_eq!((e.gen, e.state), (5, SeatState::Reserved));
        // An older admission's late unwinding, or an older seat's free, never touches it.
        d.unwind("papa", 4, m, None);
        d.unwind("papa", 4, m, Some(3));
        d.free("papa", 4);
        settle().await;
        assert_eq!(
            entry_of(&d, "papa").map(|e| (e.gen, e.state)),
            Some((5, SeatState::Reserved))
        );
        // Its own admission unwinds it: with a lease taken it stays `Leaving` until the give-back lands.
        let fence = d.persistence.acquire("papa", m).await.unwrap();
        d.unwind("papa", 5, m, Some(fence));
        assert_eq!(
            entry_of(&d, "papa").map(|e| e.state),
            Some(SeatState::Leaving)
        );
        settle().await;
        assert!(entry_of(&d, "papa").is_none());
        assert!(store(&d).lease("papa").unwrap().released);
        // A Left for a seat this process has no entry for still gives its lease back (fenced: a newer lease is safe).
        let fq = d.persistence.acquire("quebec", m).await.unwrap();
        d.reports
            .send(RoomReport::Left {
                match_id: m,
                profile: "Quebec".into(),
                fence: fq,
                result_pending: false,
            })
            .unwrap();
        settle().await;
        assert!(store(&d).lease("quebec").unwrap().released);
        let newer = d.persistence.acquire("quebec", id(2)).await.unwrap();
        d.reports
            .send(RoomReport::Left {
                match_id: m,
                profile: "quebec".into(),
                fence: fq,
                result_pending: false,
            })
            .unwrap();
        settle().await;
        let l = store(&d).lease("quebec").unwrap();
        assert_eq!(
            (l.fence, l.released),
            (newer, false),
            "a stale fence releases nothing"
        );
    }

    /// `/info` and `/control/health` use camelCase keys throughout, `closedRooms` entries included (the contract text and the
    /// room's own log line say `frameRefusals`).
    #[tokio::test]
    async fn info_and_closed_room_keys_are_exactly_these_camel_case_names() {
        let d = director();
        d.inner
            .lock()
            .unwrap()
            .closed
            .push(crate::room::RoomStats::default());
        let info = d.info();
        let sorted = |v: &serde_json::Value| {
            let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
            k.sort_unstable();
            k
        };
        let want = |names: &[&str]| {
            let mut k: Vec<String> = names.iter().map(|s| s.to_string()).collect();
            k.sort_unstable();
            k
        };
        assert_eq!(
            sorted(&info),
            want(&[
                "closedRooms",
                "contentHash",
                "lobbies",
                "maxRooms",
                "players",
                "protocol",
                "resultsFailed",
                "resultsOk",
                "resultsRefused",
                "rooms",
                "state"
            ])
        );
        assert_eq!(
            sorted(&info["closedRooms"][0]),
            want(&[
                "bytesEnqueuedTotal",
                "bytesOut",
                "crashed",
                "droppedSteps",
                "frameRefusals",
                "frameRefusalsLogged",
                "fxDropped",
                "lateWakes",
                "snapshotBytesSent",
                "snapshotRefusals",
                "snapshotRefusalsLogged",
                "snapshotsDelta",
                "snapshotsFull",
                "snapshotsSkipped",
                "stepUsMax",
                "stepUsP50",
                "stepUsP99",
                "ticks",
            ])
        );
        let health = crate::metrics::process().json();
        for k in health.as_object().unwrap().keys() {
            assert!(!k.contains('_'), "{k}");
        }
    }

    /// A join reply that arrives after the room's `Closed` was handled does not leave a session entry for the dead room.
    #[tokio::test(start_paused = true)]
    async fn a_join_reply_after_the_rooms_close_registers_no_session() {
        let d = director();
        let m = id(1);
        let (tx, mut rx) = mpsc::channel(4);
        d.inner.lock().unwrap().rooms.insert(
            m,
            RoomEntry {
                tx,
                phase: Phase::Lobby,
                seated: 0,
                reserved: 0,
            },
        );
        let d2 = d.clone();
        let admit = tokio::spawn(async move {
            d2.admit(hello("papa"), Arc::new(Outbox::default()), 1)
                .await
        });
        let Some(RoomCmd::Join { reply, .. }) = rx.recv().await else {
            panic!("a join");
        };
        // The room closed (crashed) before it replied.
        d.reports
            .send(RoomReport::Closed {
                match_id: m,
                stats: Default::default(),
                final_hash: 0,
                replay: None,
            })
            .unwrap();
        settle().await;
        assert!(d.inner.lock().unwrap().rooms.is_empty());
        let _ = reply.send(Ok(JoinOk {
            player: rh_sim::PlayerId(1),
            session: [9; 16],
            welcome: Vec::new(),
            clock: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }));
        assert!(admit.await.unwrap().is_ok());
        settle().await;
        assert!(
            d.inner.lock().unwrap().sessions.is_empty(),
            "no session for a gone room"
        );
    }

    /// A duplicate result report is answered `AlreadyApplied` before the store looks at the lease: the live lease is still
    /// given back (fenced), not left to expire.
    #[tokio::test(start_paused = true)]
    async fn a_duplicate_result_report_still_gives_its_live_lease_back() {
        let d = director_with(MemoryStore::strict());
        let m = id(1);
        let f1 = d.persistence.acquire("papa", m).await.unwrap();
        assert_eq!(
            d.persistence
                .record(m, "papa", f1, &some_result("papa"), Roster::default())
                .await,
            Ok(Recorded::Applied)
        );
        // The same match's profile holds a live lease again; a second report for the match arrives.
        let f2 = d.persistence.acquire("papa", m).await.unwrap();
        assert!(f2 > f1 && !store(&d).lease("papa").unwrap().released);
        d.inner
            .lock()
            .unwrap()
            .profiles
            .insert("papa".into(), seat(4, m, f2, SeatState::Seated));
        d.reports
            .send(RoomReport::Left {
                match_id: m,
                profile: "papa".into(),
                fence: f2,
                result_pending: true,
            })
            .unwrap();
        d.reports
            .send(RoomReport::Result {
                match_id: m,
                profile: "papa".into(),
                bot: false,
                fence: Some(f2),
                result: some_result("papa"),
                roster: Roster::default(),
            })
            .unwrap();
        settle().await;
        settle().await;
        assert!(
            store(&d).lease("papa").unwrap().released,
            "lease given back"
        );
        assert!(entry_of(&d, "papa").is_none(), "profile free");
        assert_eq!(store(&d).results.lock().unwrap().len(), 1, "applied once");
        assert_eq!(d.inner.lock().unwrap().results_ok, 1);
    }

    /// A room task that panics still reports `Closed`: its seats are freed and their leases given back, instead of the
    /// profile being refused `ProfileInUse` until the process restarts.
    #[tokio::test(start_paused = true)]
    async fn a_room_that_panics_frees_its_seats_and_leases() {
        let d = director_with(MemoryStore::strict());
        let (tx, ok) = d
            .admit(hello("papa"), Arc::new(Outbox::default()), 1)
            .await
            .expect("admitted");
        assert_eq!(
            entry_of(&d, "papa").map(|e| e.state),
            Some(SeatState::Seated)
        );
        tx.send(RoomCmd::Crash).await.unwrap();
        for _ in 0..100 {
            if entry_of(&d, "papa").is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        assert!(entry_of(&d, "papa").is_none(), "the seat was freed");
        assert!(
            store(&d).lease("papa").unwrap().released,
            "its lease given back"
        );
        {
            let inner = d.inner.lock().unwrap();
            assert!(inner.rooms.is_empty());
            assert!(inner.closed.last().is_some_and(|s| s.crashed));
        }
        drop(ok);
        // And the profile can play again.
        d.admit(hello("papa"), Arc::new(Outbox::default()), 2)
            .await
            .expect("rejoins");
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
