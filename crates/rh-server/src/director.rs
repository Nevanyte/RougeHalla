//! The match director: admission (protocol, content, credentials, profile ownership, capacity), room placement, session
//! resume, and the off-tick handling of what rooms report (results to durable storage with retries, freed profiles).
//! Several matches run in one process (one tokio task each); the hosting layer decides how many processes run per host.

use crate::control::{ControlBook, CtlError, EndMode, LeaveMode};
use crate::hosting::Lifecycle;
use crate::outbox::Outbox;
use crate::persist::{Auth, HeldLease, Persistence, ProfileKey, RecordError, Recorded};
use crate::room::{
    random16, run_room, Admission, JoinOk, MapAssets, MatchId, Room, RoomCmd, RoomConfig,
    RoomReport, RoomStats, INBOUND_CAP,
};
use rh_protocol::{RejectCode, PROTOCOL_VERSION};
use rh_sim::{Arena, FactionId, Phase, SimConfig};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, Notify};

/// The director renews one fenced row at a time per seat. Local validity is measured from
/// the start of the corresponding acquire/renew, never from the database response.
#[derive(Clone, Copy, Debug)]
pub struct LeasePolicy {
    pub ttl: Duration,
    pub renew_interval: Duration,
    pub db_timeout: Duration,
}
impl Default for LeasePolicy {
    fn default() -> Self {
        Self {
            ttl: Duration::from_secs(120),
            renew_interval: Duration::from_secs(30),
            db_timeout: Duration::from_secs(5),
        }
    }
}
impl LeasePolicy {
    pub fn validate(self) -> Result<(), &'static str> {
        if self.ttl > Duration::from_secs(3600) {
            return Err("lease TTL must be at most one hour");
        }
        if self.renew_interval.is_zero()
            || self.db_timeout.is_zero()
            || self
                .renew_interval
                .checked_add(self.db_timeout)
                .is_none_or(|d| d >= self.ttl)
            || tokio::time::Instant::now().checked_add(self.ttl).is_none()
        {
            return Err("renew interval and database timeout must be positive and together shorter than a representable lease TTL");
        }
        Ok(())
    }
}
#[derive(Clone)]
pub struct DirectorConfig {
    pub leases: LeasePolicy,
    pub sim: SimConfig,
    /// The map every room plays on, shared (never cloned per room).
    pub arena: Arc<Arena>,
    pub max_rooms: usize,
    pub fill_bots_to: usize,
    /// The legacy lobby fill (BotManager): arrivals over the countdown, closing top-up and the yield seat. None keeps
    /// the rooms' immediate placeholder fill (default for tests and benches; the server binary enables it).
    pub bot_fill: Option<crate::bot_fill::BotFillConfig>,
    pub tick: Duration,
    /// Record a private replay of every match (kept in memory for the last few rooms; tests and diagnostics).
    pub record: bool,
    pub reconnect_grace: Duration,
    pub linger: Duration,
    /// A connection that sends nothing for this long is treated as dropped (clients ping at least every second).
    pub idle_timeout: Duration,
    /// Hosted mode (`--require-admit`, docs/hosting/CONTROL_API.md section 4): a Hello is admitted only with a matching,
    /// unexpired, unconsumed admit, checked after the profile credential check and before profile ownership. Rooms then
    /// exist only through `POST /control/session`. Off: admission is exactly as it always was.
    pub require_admit: bool,
    /// Default lifetime of an admit that names no `ttlMs`.
    pub admit_ttl: Duration,
}

impl DirectorConfig {
    pub fn new(sim: SimConfig, arena: impl Into<Arc<Arena>>) -> Self {
        Self {
            leases: LeasePolicy::default(),
            sim,
            arena: arena.into(),
            max_rooms: 16,
            fill_bots_to: 0,
            bot_fill: None,
            tick: Duration::from_millis(rh_sim::constants::TICK_MS as u64),
            record: false,
            reconnect_grace: crate::room::RECONNECT_GRACE,
            linger: crate::room::LINGER,
            idle_timeout: crate::conn::IDLE_TIMEOUT,
            require_admit: false,
            admit_ttl: Duration::from_millis(crate::control::DEFAULT_TTL_MS),
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

#[derive(Clone, Debug)]
struct ProfileSeat {
    renewal: Option<tokio::task::AbortHandle>,
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

impl ProfileSeat {
    /// Retired seats must not leave heartbeat tasks sleeping until their next interval.
    fn stop_renewing(&mut self) {
        if let Some(worker) = self.renewal.take() {
            worker.abort();
        }
    }
}

/// Until admission delivers the room's reply, cancellation is owned by this guard.
/// After sending a Join the exact reply distinguishes a seat (Left/Closed owns it)
/// from a refused reservation (unwind owns it). Drop only schedules recovery.
struct PendingAdmission {
    director: std::sync::Weak<Director>,
    runtime: tokio::runtime::Handle,
    key: ProfileKey,
    gen: u64,
    match_id: MatchId,
    fence: Option<i64>,
    reply: Option<oneshot::Receiver<Result<JoinOk, RejectCode>>>,
    clock: Option<tokio::sync::watch::Sender<tokio::time::Instant>>,
    armed: bool,
}
impl Drop for PendingAdmission {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let Some(d) = self.director.upgrade() else {
            return;
        };
        let (key, gen, m, fence) = (self.key.clone(), self.gen, self.match_id, self.fence);
        let reply = self.reply.take();
        if let Some(clock) = self.clock.take() {
            // A worker never publishes a later deadline after this one expires.
            clock.send_replace(tokio::time::Instant::now());
        }
        self.runtime.spawn(async move {
            let seated = match reply {
                Some(rx) => matches!(rx.await, Ok(Ok(_))),
                None => false,
            };
            if !seated {
                d.unwind(&key, gen, m, fence);
                return;
            }
            let mut inner = d.inner.lock().expect("director");
            let room_exists = inner.rooms.contains_key(&m);
            if let Some(s) = inner
                .profiles
                .get_mut(&key)
                .filter(|s| s.gen == gen && s.match_id == m && Some(s.fence) == fence)
            {
                s.stop_renewing();
                if s.state == SeatState::Reserved {
                    s.state = if room_exists {
                        SeatState::Seated
                    } else {
                        SeatState::Leaving
                    };
                }
                d.advance(&mut inner, &key);
            }
        });
    }
}

/// C-PERSIST, in-process ownership (the durable lease fences across hosts):
///
/// * One entry per authenticated durable profile ID (a lower-cased callsign for memory seats). While it exists, an admission for that profile is refused `ProfileInUse`, or,
///   if the entry is `Leaving`, waits for it to go (at most `LEAVING_WAIT` for the whole admission, then refused). So a
///   profile never has two live seats in this process, and a new lease is never taken while the old one may still be
///   given back or written to.
/// * An entry is created only by an admission (`Reserved`, under a fresh `gen`) and removed only by its owner: the
///   admission's own unwinding, or the give-back / result write of the seat it became, each naming the `gen`.
/// * The lease of a seat that left is given back only once no result is due or in flight for it; a write that lands
///   releases the lease itself.
#[derive(Default)]
struct Inner {
    /// The control API's game sessions, admits and player statuses (control.rs). Plain data: no I/O under this lock.
    control: ControlBook,
    rooms: HashMap<MatchId, RoomEntry>,
    profiles: HashMap<ProfileKey, ProfileSeat>,
    /// The last `ProfileSeat::gen` handed out.
    gens: u64,
    sessions: HashMap<[u8; 16], MatchId>,
    closed: Vec<RoomStats>,
    results_ok: u64,
    results_failed: u64,
    /// Results the store refused for good (no lease, stale fence): not retried.
    results_refused: u64,
    /// Durable-spool accounting (see `spool.rs`): a result is first `spooled` (fsynced, survives a process restart on this
    /// host) and later `committed` (`results_ok`: PostgreSQL has it, the only host-loss-durable point).
    results_spooled: u64,
    /// Results whose append failed because the spool was full (they fall back to in-memory retry only).
    spool_full: u64,
    /// Results whose append failed on I/O (same fallback).
    spool_errors: u64,
    /// Spooled results committed (or found already applied) by the startup recovery pass.
    results_recovered: u64,
    /// Records moved to the dead-letter directory by this process (refused, permanently rejected, unreadable at startup).
    results_dead_lettered: u64,
    /// Alerts raised for results unresolved past `retry_deadline` (they keep retrying; nothing is dead-lettered for time).
    results_stuck_alerts: u64,
    replays: Vec<rh_sim::replay::Replay>,
}

/// Attempts per result write (100 ms doubling to 5 s: about two minutes in all). Only transient errors are retried.
pub const RESULT_ATTEMPTS: u32 = 30;

/// How a spooled result ended in this process.
#[cfg(feature = "postgres")]
enum SpoolEnd {
    Committed { applied: bool },
    DeadLettered,
}

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
    /// The durable result spool (`--result-spool`); `None` keeps the in-memory-only retry.
    #[cfg(feature = "postgres")]
    spool: Option<Arc<crate::spool::ResultSpool>>,
    /// Bounds the spooled writes in flight at once, so a recovery pass cannot stampede the connection pool.
    #[cfg(feature = "postgres")]
    spool_permits: tokio::sync::Semaphore,
}

/// How long an admission waits, in all (one deadline shared by its retries), for a profile that is mid-release (its lease
/// give-back or result write is in flight) before it is refused as in use. A release is milliseconds; a result write that
/// is being retried can take minutes, and that is a refusal, not a wait.
pub const LEAVING_WAIT: Duration = Duration::from_secs(3);

pub struct Hello {
    pub protocol: u16,
    pub content_hash: u64,
    pub profile: String,
    /// Opaque admission credential ([`rh_protocol::ClientMsg::Hello`]).
    pub ticket: Vec<u8>,
    pub faction: Option<u8>,
    pub resume: Option<[u8; 16]>,
}

/// A training room is not publicly admissible yet: the practice room has no client creation route (deferred to
/// P-HOST-1/P-NET), so the matchmaking director refuses a training profile outright. Tests construct a Room directly with a
/// training config; nothing in the hosted path can start one.
fn refuse_training_profile(sim: &rh_sim::SimConfig) {
    assert!(
        !sim.training,
        "training rooms have no public admission route (deferred to P-HOST-1/P-NET); construct a Room directly in tests"
    );
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
        Self::build(
            cfg,
            persistence,
            auth,
            lifecycle,
            #[cfg(feature = "postgres")]
            None,
        )
    }

    /// As [`Director::new`], with the durable result spool. Panics if the persistence is not PostgreSQL: a spool record
    /// can only be replayed into the durable store.
    #[cfg(feature = "postgres")]
    pub fn new_with_spool(
        cfg: DirectorConfig,
        persistence: Arc<Persistence>,
        auth: Arc<Auth>,
        lifecycle: Arc<Lifecycle>,
        spool: Arc<crate::spool::ResultSpool>,
    ) -> Arc<Self> {
        assert!(
            persistence.is_durable(),
            "a result spool needs the PostgreSQL store"
        );
        Self::build(cfg, persistence, auth, lifecycle, Some(spool))
    }

    fn build(
        cfg: DirectorConfig,
        persistence: Arc<Persistence>,
        auth: Arc<Auth>,
        lifecycle: Arc<Lifecycle>,
        #[cfg(feature = "postgres")] spool: Option<Arc<crate::spool::ResultSpool>>,
    ) -> Arc<Self> {
        refuse_training_profile(&cfg.sim);
        crate::wire::profile_supported(&cfg.sim)
            .expect("refusing to host unsupported simulation profile");
        cfg.leases.validate().expect("invalid lease policy");
        if let Err(e) = crate::wire::arena_fits(&cfg.arena) {
            panic!("refusing to host this arena: {e}");
        }
        let (tx, rx) = mpsc::unbounded_channel();
        let map = MapAssets::new(cfg.arena.clone()).expect("the arena's map encodes as a Welcome");
        let inner = Inner {
            control: ControlBook::new(cfg.admit_ttl, cfg.reconnect_grace),
            ..Inner::default()
        };
        let d = Arc::new_cyclic(|me| Self {
            pending_writes: std::sync::atomic::AtomicUsize::new(0),
            cfg,
            map,
            inner: Mutex::new(inner),
            reports: tx,
            persistence,
            auth,
            lifecycle,
            freed: Notify::new(),
            me: me.clone(),
            #[cfg(feature = "postgres")]
            spool,
            #[cfg(feature = "postgres")]
            spool_permits: tokio::sync::Semaphore::new(8),
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
        let Some(key) = self
            .persistence
            .authenticate(&self.auth, &h.profile, &h.ticket)
            .await
        else {
            return Err((RejectCode::BadCredentials, "bad credentials".into()));
        };
        // Hosted mode: an additional precondition after the credential check and before profile ownership and the fenced
        // lease (CONTROL_API.md section 4). It never replaces authentication and takes no lease. The admit is consumed
        // below, atomically with the seat reservation; this early look only refuses before any wait.
        if self.cfg.require_admit
            && !self
                .inner
                .lock()
                .expect("director")
                .control
                .has_admit(&h.profile, tokio::time::Instant::now())
        {
            return Err((RejectCode::BadCredentials, "not admitted".into()));
        }
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
            let next_gen = inner.gens + 1;
            let (match_id, tx) = if self.cfg.require_admit {
                // Hosted mode: the room is the one the admit names (no automatic lobby placement, no room opened here).
                // The admit is consumed here, in the critical section that reserves the seat; any later failure of this
                // admission restores it (`unwind`).
                let Some(taken) =
                    inner
                        .control
                        .take_admit(&h.profile, tokio::time::Instant::now(), next_gen)
                else {
                    return Err((RejectCode::BadCredentials, "not admitted".into()));
                };
                let target = inner
                    .rooms
                    .get(&taken.room)
                    .map(|r| (r.phase == Phase::Lobby, r.tx.clone()));
                match target {
                    Some((true, tx)) => (taken.room, tx),
                    other => {
                        inner.control.restore_gen(next_gen);
                        let why = if other.is_none() {
                            "match closed"
                        } else {
                            "match in progress"
                        };
                        return Err((RejectCode::MatchFull, why.into()));
                    }
                }
            } else {
                let open = open_lobby(&inner.rooms)
                    .and_then(|id| inner.rooms.get(&id).map(|r| (id, r.tx.clone())));
                match open {
                    Some(x) => x,
                    None => {
                        if inner.rooms.len() >= self.cfg.max_rooms {
                            return Err((RejectCode::MatchFull, "no capacity".into()));
                        }
                        self.spawn_room(&mut inner, self.cfg.fill_bots_to)
                    }
                }
            };
            inner.gens += 1;
            let gen = inner.gens;
            inner.profiles.insert(
                key.clone(),
                ProfileSeat {
                    renewal: None,
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
        let mut pending = PendingAdmission {
            director: self.me.clone(),
            runtime: tokio::runtime::Handle::current(),
            key: key.clone(),
            gen,
            match_id,
            fence: None,
            reply: None,
            clock: None,
            armed: true,
        };
        let policy = self.cfg.leases;
        let started = tokio::time::Instant::now();
        let acquisition = self
            .persistence
            .acquire_live(&key, match_id, &h.profile, policy);
        let acquisition = tokio::time::timeout(policy.db_timeout, acquisition)
            .await
            .unwrap_or_else(|_| Err("lease acquisition timed out".into()));
        let lease = match acquisition {
            Ok(lease) => lease,
            Err(e) => {
                pending.armed = false;
                self.unwind(&key, gen, match_id, None);
                return Err((RejectCode::ProfileInUse, e));
            }
        };
        let fence = lease.fence;
        pending.fence = Some(fence);
        if let Some(s) = self.inner.lock().expect("director").profiles.get_mut(&key) {
            if s.gen == gen {
                s.fence = fence;
            }
        }
        let (reply, rx) = oneshot::channel();
        let faction = h.faction.and_then(FactionId::from_code);
        let deadline = started + policy.ttl;
        let (validity, clock) = tokio::sync::watch::channel(deadline);
        let request = RoomCmd::JoinLeased {
            admission: Admission {
                gen,
                profile_id: key.id(),
            },
            profile: h.profile.clone(),
            faction,
            outbox,
            conn,
            fence,
            deadline: clock,
            reply,
        };
        match tokio::time::timeout_at(deadline, tx.send(request)).await {
            Ok(Ok(())) => {}
            failed => {
                pending.armed = false;
                self.unwind(&key, gen, match_id, Some(fence));
                if failed.is_ok() {
                    self.mark_unjoinable(match_id);
                    return Err((RejectCode::MatchFull, "match closed".into()));
                }
                return Err((
                    RejectCode::ProfileInUse,
                    "lease expired before seating".into(),
                ));
            }
        }
        pending.clock = Some(validity.clone());
        pending.reply = Some(rx);
        self.start_renewals(key.clone(), gen, match_id, lease, started, validity);
        let outcome = pending.reply.as_mut().expect("join sent").await;
        pending.armed = false;
        match outcome {
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

    /// The fill policy a new room gets, with the room's fill count (the config's own fill_to is the default for
    /// direct room construction): None leaves the room on its immediate placeholder fill.
    fn fill_policy(&self, fill_bots_to: usize) -> Option<crate::bot_fill::BotFillConfig> {
        self.cfg
            .bot_fill
            .as_ref()
            .map(|fill| crate::bot_fill::BotFillConfig {
                fill_to: fill_bots_to,
                ..fill.clone()
            })
    }

    /// Spawns a room task and registers it (the lock is held). Used by admission (a lobby opened on demand) and by the
    /// control API (a room per game session); never blocks.
    fn spawn_room(
        &self,
        inner: &mut Inner,
        fill_bots_to: usize,
    ) -> (MatchId, mpsc::Sender<RoomCmd>) {
        let id = random16();
        let (tx, rx) = mpsc::channel(INBOUND_CAP);
        let rc = RoomConfig {
            sim: self.cfg.sim.clone(),
            arena: self.map.arena.clone(),
            welcome_map: self.map.welcome_map.clone(),
            fill_bots_to,
            tick: self.cfg.tick,
            record: self.cfg.record,
            fixed_secrets: None,
            fixed_bot_seed: None,
            reconnect_grace: self.cfg.reconnect_grace,
            linger: self.cfg.linger,
        };
        let mut room = Room::new(id, rc, self.reports.clone(), tokio::time::Instant::now());
        if let Some(fill) = self.fill_policy(fill_bots_to) {
            room = room.with_bot_fill(fill);
        }
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

    /// There is at most one in-flight renewal per admitted seat. The worker holds neither
    /// the director nor its lock while sleeping or accessing durable storage. Result-pending
    /// and writing seats keep renewing even after their connection and room have gone.
    fn start_renewals(
        &self,
        key: ProfileKey,
        gen: u64,
        match_id: MatchId,
        lease: HeldLease,
        started: tokio::time::Instant,
        validity: tokio::sync::watch::Sender<tokio::time::Instant>,
    ) {
        let weak = self.me.clone();
        let store = self.persistence.clone();
        let policy = self.cfg.leases;
        let mut inner = self.inner.lock().expect("director");
        let Some(owner) = inner.profiles.get_mut(&key).filter(|s| {
            s.gen == gen
                && s.match_id == match_id
                && s.fence == lease.fence
                && s.lease == LeaseState::Held
        }) else {
            return;
        };
        let worker = tokio::spawn(async move {
            use tokio::time::{sleep_until, timeout_at, Instant};
            let current = || {
                weak.upgrade().is_some_and(|d| {
                    d.inner
                        .lock()
                        .expect("director")
                        .profiles
                        .get(&key)
                        .is_some_and(|s| {
                            s.gen == gen
                                && s.match_id == match_id
                                && s.fence == lease.fence
                                && s.lease == LeaseState::Held
                        })
                })
            };
            let mut deadline = started + policy.ttl;
            let mut next = started + policy.renew_interval;
            loop {
                sleep_until(next.min(deadline)).await;
                let attempt = Instant::now();
                if attempt >= deadline || !current() {
                    break;
                }
                let outcome = timeout_at(
                    deadline.min(attempt + policy.db_timeout),
                    store.renew(&key, match_id, lease, policy.ttl),
                )
                .await;
                // Old-generation completions cannot change the new seat. A delayed success
                // must never revive one that crossed its confirmed local deadline.
                if !current() {
                    break;
                }
                let now = Instant::now();
                if now >= deadline {
                    break;
                }
                match outcome {
                    Ok(Ok(true)) => {
                        deadline = attempt + policy.ttl;
                        if !validity.send_if_modified(|confirmed| {
                            if *confirmed <= Instant::now() {
                                return false;
                            }
                            *confirmed = deadline;
                            true
                        }) {
                            break;
                        }
                        next = attempt + policy.renew_interval;
                    }
                    Ok(Ok(false)) => {
                        // A committed result may have released the row; the room keeps a
                        // resolved seat for reliable delivery. Only unresolved seats revoke.
                        validity.send_replace(now);
                        break;
                    }
                    Ok(Err(_)) | Err(_) => {
                        next = now + policy.renew_interval.min(policy.db_timeout)
                    }
                }
            }
        });
        owner.renewal = Some(worker.abort_handle());
    }

    /// Unwinds an admission that took no seat: its room reservation goes, and its own entry (`gen`) is removed at once when
    /// no lease was taken, or stays `Leaving` until the lease give-back lands (so a retry, or another connection for the
    /// profile, waits for the give-back instead of racing it).
    fn unwind(&self, key: &ProfileKey, gen: u64, match_id: MatchId, fence: Option<i64>) {
        let mut inner = self.inner.lock().expect("director");
        // Hosted mode: an admission that took no seat gives the admit back (pending again, same deadline).
        inner.control.restore_gen(gen);
        let own = inner
            .profiles
            .get(key)
            .is_some_and(|s| s.gen == gen && s.match_id == match_id);
        if own {
            if let Some(r) = inner.rooms.get_mut(&match_id) {
                r.reserved = r.reserved.saturating_sub(1);
            }
        }
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
                    s.stop_renewing();
                    s.lease = LeaseState::Releasing;
                }
                drop(inner);
                self.give_back(key, match_id, fence, own.then_some(gen));
            }
        }
    }

    /// Moves a `Leaving` entry on (the lock is held): nothing while a result is due or a write is in flight (the write
    /// releases the lease itself); then the lease is given back unless a write already released it, and the entry is
    /// freed when that lands.
    fn advance(&self, inner: &mut Inner, key: &ProfileKey) {
        let Some(s) = inner.profiles.get_mut(key) else {
            return;
        };
        if s.state != SeatState::Leaving || s.result_due || s.writes > 0 {
            return;
        }
        match s.lease {
            LeaseState::Held => {
                s.stop_renewing();
                s.lease = LeaseState::Releasing;
                let (fence, gen) = (s.fence, s.gen);
                self.give_back(key, s.match_id, fence, Some(gen));
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
    fn give_back(&self, key: &ProfileKey, match_id: MatchId, fence: i64, owner: Option<u64>) {
        let Some(d) = self.me.upgrade() else {
            return;
        };
        let key = key.clone();
        tokio::spawn(async move {
            let _ = d.persistence.release_live(&key, match_id, fence).await;
            if let Some(gen) = owner {
                d.free(&key, gen);
            }
        });
    }

    async fn report_loop(this: Arc<Self>, mut rx: mpsc::UnboundedReceiver<RoomReport>) {
        while let Some(r) = rx.recv().await {
            match r {
                RoomReport::Left {
                    admission,
                    match_id,
                    profile,
                    fence,
                    result_pending,
                } => {
                    let key =
                        ProfileKey::from_report(&profile, admission.and_then(|a| a.profile_id));
                    let mut inner = this.inner.lock().expect("director");
                    let seat = inner
                        .profiles
                        .get(&key)
                        .filter(|s| {
                            s.match_id == match_id
                                && s.fence == fence
                                && admission.is_none_or(|a| a.gen == s.gen)
                        })
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
                            this.give_back(&key, match_id, fence, None);
                        }
                    }
                }
                RoomReport::Result {
                    admission,
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
                    let key =
                        ProfileKey::from_report(&profile, admission.and_then(|a| a.profile_id));
                    // The seat it belongs to counts the write as in flight: its lease is not given back meanwhile.
                    let (fence, owner) = {
                        let mut inner = this.inner.lock().expect("director");
                        match inner.profiles.get_mut(&key).filter(|s| {
                            s.match_id == match_id
                                && fence.is_none_or(|f| f == s.fence)
                                && admission.is_none_or(|a| a.gen == s.gen)
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
                        // Whether the lease is gone after the write: released by its transaction, or no longer ours.
                        let lease_gone = d
                            .write_result(match_id, &profile, fence, &result, roster, key.id())
                            .await;
                        let mut inner = d.inner.lock().expect("director");
                        match owner {
                            Some(gen) => {
                                let mut mine = false;
                                if let Some(s) =
                                    inner.profiles.get_mut(&key).filter(|s| s.gen == gen)
                                {
                                    s.writes -= 1;
                                    if lease_gone && s.lease == LeaseState::Held {
                                        s.stop_renewing();
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
                                d.give_back(&key, match_id, fence, None);
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
                    let mut moved: Vec<ProfileKey> = Vec::new();
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
                    let stats_crashed = stats.crashed;
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
                    let draining = this.lifecycle.draining();
                    inner.control.on_closed(
                        match_id,
                        stats_crashed,
                        draining,
                        tokio::time::Instant::now(),
                    );
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
                    let mut inner = this.inner.lock().expect("director");
                    if let Some(r) = inner.rooms.get_mut(&match_id) {
                        // The admission that took this seat stops being a reservation; the others still are.
                        r.reserved = r.reserved.saturating_sub(1);
                        r.seated = humans;
                        r.phase = phase;
                    }
                    inner.control.on_phase(match_id, phase);
                }
                RoomReport::Seat {
                    match_id,
                    profile,
                    event,
                } => {
                    let took = this
                        .inner
                        .lock()
                        .expect("director")
                        .control
                        .on_seat(match_id, &profile, event);
                    if let Some(took) = took {
                        crate::metrics::process().note_admit_to_seat(took);
                    }
                }
                RoomReport::Phase { match_id, phase } => {
                    let mut inner = this.inner.lock().expect("director");
                    if let Some(r) = inner.rooms.get_mut(&match_id) {
                        r.phase = phase;
                    }
                    inner.control.on_phase(match_id, phase);
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
    fn free(&self, key: &ProfileKey, gen: u64) {
        let mut inner = self.inner.lock().expect("director");
        let mine = match inner.profiles.get_mut(key) {
            Some(s) if s.gen == gen => {
                s.stop_renewing();
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
    async fn wait_while_leaving(&self, key: &ProfileKey, deadline: tokio::time::Instant) {
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

    // ---- the control API (docs/hosting/CONTROL_API.md); the HTTP layer is `control_http` in lib.rs ----

    /// The `control` object of `GET /control/health`: what the bridge checks before it reports the process ready.
    pub fn control_info(&self) -> serde_json::Value {
        serde_json::json!({
            "v": crate::control::API_VERSION,
            "requireAdmit": self.cfg.require_admit,
            "maxRooms": self.cfg.max_rooms,
            "admitTtlMs": self.cfg.admit_ttl.as_millis() as u64,
        })
    }

    /// `POST /control/session`: the room for one game session. Idempotent per `gameSessionId`.
    pub fn control_create(
        &self,
        gsid: &str,
        max_players: Option<usize>,
        fill_bots_to: Option<usize>,
    ) -> Result<serde_json::Value, CtlError> {
        let max_players = max_players.unwrap_or(rh_sim::constants::MAX_PLAYERS);
        if !(1..=rh_sim::constants::MAX_PLAYERS).contains(&max_players) {
            return Err(CtlError::bad_request(format!(
                "maxPlayers must be 1..={}",
                rh_sim::constants::MAX_PLAYERS
            )));
        }
        let fill = fill_bots_to.unwrap_or(self.cfg.fill_bots_to.min(max_players));
        if fill > max_players {
            return Err(CtlError::bad_request("fillBotsTo must be 0..=maxPlayers"));
        }
        match self.lifecycle.state_name() {
            "starting" => return Err(CtlError::new(503, "not_ready", "the server is starting")),
            "ready" => {}
            _ => return Err(CtlError::conflict("draining", "the server is draining")),
        }
        let mut inner = self.inner.lock().expect("director");
        // Re-checked under the lock: `drain` flips the lifecycle first and only then reads the rooms under this same lock, so
        // a create that still sees `ready` here has its room in place before drain looks (drain then waits for it), and a
        // create that comes later is refused. Without this a session created during a drain could outlive `Terminated`.
        match self.lifecycle.state_name() {
            "ready" => {}
            "starting" => return Err(CtlError::new(503, "not_ready", "the server is starting")),
            _ => return Err(CtlError::conflict("draining", "the server is draining")),
        }
        inner.control.sweep(tokio::time::Instant::now());
        match inner.control.check_create(gsid, max_players, fill)? {
            crate::control::CreateCheck::Existing {
                room,
                phase,
                max_players,
            } => Ok(serde_json::json!({
                "v": crate::control::API_VERSION, "created": false, "gameSessionId": gsid,
                "roomId": crate::control::room_id_hex(room), "phase": phase.as_str(), "maxPlayers": max_players,
            })),
            crate::control::CreateCheck::New => {
                if inner.rooms.len() >= self.cfg.max_rooms {
                    return Err(CtlError::conflict("at_capacity", "no room capacity left"));
                }
                let (id, _tx) = self.spawn_room(&mut inner, fill);
                inner.control.insert(gsid, id, max_players, fill);
                Ok(serde_json::json!({
                    "v": crate::control::API_VERSION, "created": true, "gameSessionId": gsid,
                    "roomId": crate::control::room_id_hex(id), "phase": "lobby", "maxPlayers": max_players,
                }))
            }
        }
    }

    /// `POST /control/admit`.
    pub fn control_admit(
        &self,
        gsid: &str,
        psid: &str,
        callsign: &str,
        ttl: Option<Duration>,
    ) -> Result<serde_json::Value, CtlError> {
        let draining = self.lifecycle.draining();
        let mut inner = self.inner.lock().expect("director");
        let ttl = ttl.unwrap_or(self.cfg.admit_ttl);
        let o = inner.control.admit(
            gsid,
            psid,
            callsign,
            ttl,
            tokio::time::Instant::now(),
            draining,
        )?;
        Ok(serde_json::json!({
            "v": crate::control::API_VERSION, "state": o.state, "gameSessionId": o.game_session_id,
            "playerSessionId": o.player_session_id, "callsign": o.callsign, "expiresInMs": o.expires_in_ms,
        }))
    }

    /// `GET /control/rooms`.
    pub fn control_rooms(&self) -> serde_json::Value {
        let mut inner = self.inner.lock().expect("director");
        let rooms = inner.control.rooms_json(tokio::time::Instant::now());
        serde_json::json!({
            "v": crate::control::API_VERSION,
            "state": self.lifecycle.state_name(),
            "draining": self.lifecycle.draining(),
            "maxRooms": self.cfg.max_rooms,
            "rooms": rooms,
        })
    }

    /// `POST /control/leave`. A kick marks the player `left` (reason `kicked`) at once and tells the room, which removes the
    /// seat through the same path as a disconnect past the grace.
    pub async fn control_leave(
        &self,
        gsid: &str,
        psid: &str,
        mode: LeaveMode,
    ) -> Result<serde_json::Value, CtlError> {
        // A kick must reach the room or not happen at all: room-mailbox space is reserved BEFORE the book is touched, so a
        // full mailbox answers 503 with the player still as it was (the bridge retries), never `left` with the room unaware.
        let tx = if mode == LeaveMode::Kick {
            let inner = self.inner.lock().expect("director");
            inner
                .control
                .room_of(gsid)
                .and_then(|room| inner.rooms.get(&room).map(|r| r.tx.clone()))
        } else {
            None
        };
        let permit = match &tx {
            Some(tx) => reserve_room_slot(tx, Duration::from_secs(2)).await?,
            None => None,
        };
        let out = {
            let mut inner = self.inner.lock().expect("director");
            inner
                .control
                .leave(gsid, psid, mode, tokio::time::Instant::now())?
        };
        if let (Some((_, profile)), Some(permit)) = (out.kick, permit) {
            permit.send(RoomCmd::Kick { profile });
        }
        Ok(serde_json::json!({"v": crate::control::API_VERSION, "state": out.state}))
    }

    /// `POST /control/end`. `abort` waits (bounded) for the room to report closed so the answer says so.
    pub async fn control_end(
        &self,
        gsid: &str,
        mode: EndMode,
    ) -> Result<serde_json::Value, CtlError> {
        // Same rule as `control_leave`: the room's mailbox slot is reserved before the book changes, so a room that cannot
        // be told is a 503 and the session is not marked ending.
        let tx = {
            let inner = self.inner.lock().expect("director");
            inner
                .control
                .room_of(gsid)
                .and_then(|room| inner.rooms.get(&room).map(|r| r.tx.clone()))
        };
        let permit = match &tx {
            Some(tx) => reserve_room_slot(tx, Duration::from_secs(2)).await?,
            None => None,
        };
        let out = {
            let mut inner = self.inner.lock().expect("director");
            inner.control.end(gsid, mode, tokio::time::Instant::now())?
        };
        if let (Some(m), Some(permit)) = (out.tell_room, permit) {
            permit.send(match m {
                EndMode::Graceful => RoomCmd::Drain,
                EndMode::Abort => RoomCmd::Abort,
            });
        }
        if out.tell_room == Some(EndMode::Abort) {
            let until = tokio::time::Instant::now() + Duration::from_secs(2);
            while tokio::time::Instant::now() < until {
                let closed = self
                    .inner
                    .lock()
                    .expect("director")
                    .control
                    .phase_of(gsid)
                    .is_none_or(|p| p == crate::control::CPhase::Closed);
                if closed {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        }
        let phase = self
            .inner
            .lock()
            .expect("director")
            .control
            .phase_of(gsid)
            .unwrap_or(out.phase);
        Ok(serde_json::json!({"v": crate::control::API_VERSION, "phase": phase.as_str()}))
    }

    /// Recorded replays of the last closed rooms (private: they hold match secrets).
    pub fn take_replays(&self) -> Vec<rh_sim::replay::Replay> {
        std::mem::take(&mut self.inner.lock().expect("director").replays)
    }

    /// Writes one result off the room task and says whether the lease is gone afterwards (released by the write's own
    /// transaction, or no longer ours). With a spool the record is made durable first (see `spool.rs`); without one, or
    /// when the spool is full or unwritable, this is the in-memory retry that predates the spool.
    async fn write_result(
        self: &Arc<Self>,
        match_id: MatchId,
        profile: &str,
        fence: i64,
        result: &rh_sim::RunResult,
        roster: crate::room::Roster,
        durable_id: Option<i64>,
    ) -> bool {
        #[cfg(feature = "postgres")]
        if let Some((name, rec, spool)) = self
            .spool_result(match_id, profile, fence, result, roster, durable_id)
            .await
        {
            return match self.drive_spooled(&spool, &name, &rec, false).await {
                // The write released the lease itself.
                SpoolEnd::Committed { applied: true } => true,
                // A duplicate: the ordinary fenced give-back releases the lease (a no-op if it moved on).
                SpoolEnd::Committed { applied: false } => false,
                // Refused for good. The lease is deliberately NOT released: a release would make a
                // later operator replay of the dead letter impossible, and an unreleased lease only expires.
                SpoolEnd::DeadLettered => true,
            };
        }
        self.write_unspooled(match_id, profile, fence, result, roster, durable_id)
            .await
    }

    async fn write_unspooled(
        self: &Arc<Self>,
        match_id: MatchId,
        profile: &str,
        fence: i64,
        result: &rh_sim::RunResult,
        roster: crate::room::Roster,
        durable_id: Option<i64>,
    ) -> bool {
        let d = self;
        let key_id = durable_id;
        let mut delay = Duration::from_millis(100);
        let mut lease_gone = false;
        for attempt in 0..RESULT_ATTEMPTS {
            match d
                .persistence
                .record_with_id(match_id, profile, fence, result, roster, key_id)
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
                Err(RecordError::Refused(e) | RecordError::Permanent(e)) => {
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
        lease_gone
    }

    /// Result-handoff counters for `/control/health` (loopback only; `/info` and its pinned key set are unchanged).
    /// `spooled`: fsynced locally (survives a process restart on this host). `committed`: in PostgreSQL (the only
    /// host-loss-durable point; the same count as `resultsOk` in `/info`).
    pub fn result_metrics(&self) -> serde_json::Value {
        let inner = self.inner.lock().expect("director");
        serde_json::json!({
            "spooled": inner.results_spooled,
            "committed": inner.results_ok,
            "recovered": inner.results_recovered,
            "refused": inner.results_refused,
            "failed": inner.results_failed,
            "deadLettered": inner.results_dead_lettered,
            "stuckAlerts": inner.results_stuck_alerts,
            "deadOverflow": self.spool_dead_overflow(),
            "spoolFull": inner.spool_full,
            "spoolErrors": inner.spool_errors,
            "spoolPending": self.spool_pending(),
            "spoolDead": self.spool_dead(),
        })
    }

    #[cfg(feature = "postgres")]
    fn spool_pending(&self) -> usize {
        self.spool.as_ref().map_or(0, |s| s.stats().pending)
    }
    #[cfg(feature = "postgres")]
    fn spool_dead(&self) -> usize {
        self.spool.as_ref().map_or(0, |s| s.stats().dead)
    }
    #[cfg(feature = "postgres")]
    fn spool_dead_overflow(&self) -> u64 {
        self.spool
            .as_ref()
            .map_or(0, |s| s.stats().dead_overflow_total)
    }
    #[cfg(not(feature = "postgres"))]
    fn spool_dead_overflow(&self) -> u64 {
        0
    }
    #[cfg(not(feature = "postgres"))]
    fn spool_pending(&self) -> usize {
        0
    }
    #[cfg(not(feature = "postgres"))]
    fn spool_dead(&self) -> usize {
        0
    }

    /// Makes the result durable locally before the first database attempt. `None` means no spool record exists (no
    /// spool, no durable identity, full, or unwritable) and the caller retries in memory only: the result is then in
    /// the wider loss window, which is counted and logged, never hidden.
    #[cfg(feature = "postgres")]
    async fn spool_result(
        &self,
        match_id: MatchId,
        profile: &str,
        fence: i64,
        result: &rh_sim::RunResult,
        roster: crate::room::Roster,
        durable_id: Option<i64>,
    ) -> Option<(
        String,
        crate::spool::SpoolRecord,
        Arc<crate::spool::ResultSpool>,
    )> {
        let spool = self.spool.clone()?;
        let id = durable_id?;
        let meta = self.persistence.spool_meta(roster)?;
        let rec = crate::spool::SpoolRecord::new(
            uuid::Uuid::from_bytes(match_id),
            id,
            profile,
            fence,
            meta,
            crate::persist::pg::to_persist(result),
        );
        let name = rec.file_name();
        let (s2, r2) = (spool.clone(), rec.clone());
        let appended = tokio::task::spawn_blocking(move || s2.append(&r2)).await;
        match appended {
            Ok(Ok(_)) => {
                self.inner.lock().expect("director").results_spooled += 1;
                eprintln!(
                    "[results] spooled match={} profile_id={id} fence={fence} (durable on this host only; not yet committed)",
                    rec.match_id
                );
                Some((name, rec, spool))
            }
            Ok(Err(crate::spool::SpoolError::Full)) => {
                self.inner.lock().expect("director").spool_full += 1;
                eprintln!(
                    "[results] spool FULL: match={} profile_id={id} is retried in memory only",
                    rec.match_id
                );
                None
            }
            other => {
                self.inner.lock().expect("director").spool_errors += 1;
                let why = match other {
                    Ok(Err(e)) => e.to_string(),
                    Err(e) => e.to_string(),
                    Ok(Ok(_)) => unreachable!(),
                };
                eprintln!("[results] spool append failed ({why}): match={} profile_id={id} is retried in memory only", rec.match_id);
                None
            }
        }
    }

    /// Replays one spooled record through the fenced store path until it commits or is refused for good. A TRANSIENT
    /// error is retried forever at `backoff_max` (a database outage of any length must not lose a result; the profile
    /// gate stays held, which costs nothing because admission needs the same database). `retry_deadline` is only an
    /// alert threshold: past it the record is logged and counted as stuck, repeatedly. The record is removed only after
    /// the commit (or a definitive `AlreadyApplied`); a definitive refusal ([`RecordError::Refused`] or
    /// [`RecordError::Permanent`]) is dead-lettered. Never acquires, renews or releases a lease.
    #[cfg(feature = "postgres")]
    async fn drive_spooled(
        &self,
        spool: &Arc<crate::spool::ResultSpool>,
        name: &str,
        rec: &crate::spool::SpoolRecord,
        recovered: bool,
    ) -> SpoolEnd {
        let started = tokio::time::Instant::now();
        let alert_every = spool.cfg.retry_deadline.max(Duration::from_millis(1));
        let mut next_alert = started + alert_every;
        let mut delay = spool.cfg.backoff_initial;
        loop {
            let attempt = {
                let _permit = self.spool_permits.acquire().await.expect("semaphore");
                self.persistence.record_spooled(rec).await
            };
            let dead = |reason: String| {
                let (s, n) = (spool.clone(), name.to_owned());
                async move {
                    let r = reason.clone();
                    match tokio::task::spawn_blocking(move || s.dead_letter(&n, &r)).await {
                        Ok(Ok(out)) => out,
                        Ok(Err(e)) => {
                            eprintln!("[results] could not dead-letter record: {e}");
                            crate::spool::DeadOutcome::Overflow
                        }
                        Err(_) => crate::spool::DeadOutcome::Overflow,
                    }
                }
            };
            match attempt {
                Ok(done) => {
                    let (s, n) = (spool.clone(), name.to_owned());
                    if let Ok(Err(e)) = tokio::task::spawn_blocking(move || s.remove(&n)).await {
                        // The result IS committed; a leftover record is replayed as AlreadyApplied and cleared.
                        eprintln!("[results] committed but could not remove its spool record: {e}");
                    }
                    {
                        let mut inner = self.inner.lock().expect("director");
                        inner.results_ok += 1;
                        if recovered {
                            inner.results_recovered += 1;
                        }
                    }
                    eprintln!(
                        "[results] committed match={} profile_id={} ({}{})",
                        rec.match_id,
                        rec.profile_id,
                        if done == Recorded::Applied {
                            "applied"
                        } else {
                            "already applied"
                        },
                        if recovered {
                            ", recovered from spool"
                        } else {
                            ""
                        }
                    );
                    return SpoolEnd::Committed {
                        applied: done == Recorded::Applied,
                    };
                }
                Err(e @ (RecordError::Refused(_) | RecordError::Permanent(_))) => {
                    let permanent = matches!(e, RecordError::Permanent(_));
                    let why = match &e {
                        RecordError::Refused(w) => format!("refused by the store: {w}"),
                        RecordError::Permanent(w) => format!("permanent store error: {w}"),
                        RecordError::Transient(_) => unreachable!(),
                    };
                    let out = dead(why.clone()).await;
                    {
                        let mut inner = self.inner.lock().expect("director");
                        if permanent {
                            inner.results_failed += 1;
                        } else {
                            inner.results_refused += 1;
                        }
                        if out == crate::spool::DeadOutcome::Moved {
                            inner.results_dead_lettered += 1;
                        }
                    }
                    eprintln!(
                        "[results] DEAD-LETTERED match={} profile_id={}: {why}; never retried{}",
                        rec.match_id,
                        rec.profile_id,
                        if out == crate::spool::DeadOutcome::Overflow {
                            " (dead-letter directory full or unwritable: the record stays pending)"
                        } else {
                            ""
                        }
                    );
                    return SpoolEnd::DeadLettered;
                }
                Err(RecordError::Transient(e)) => {
                    let now = tokio::time::Instant::now();
                    if now >= next_alert {
                        next_alert = now + alert_every;
                        self.inner.lock().expect("director").results_stuck_alerts += 1;
                        eprintln!(
                            "[results] STUCK match={} profile_id={}: still not committed after {}s ({e}); keeps retrying every {}s at most, never dead-lettered for time",
                            rec.match_id,
                            rec.profile_id,
                            started.elapsed().as_secs(),
                            spool.cfg.backoff_max.as_secs().max(1)
                        );
                    }
                    tokio::time::sleep(delay).await;
                    delay = (delay * 2).min(spool.cfg.backoff_max);
                }
            }
        }
    }

    /// Startup recovery: replays every spooled record left by an earlier process through the SAME fenced path with its
    /// original fence, identity and metadata. Call once, before the listener accepts admissions. Each profile with a
    /// pending record is held `Leaving` (no lease state) until its records resolve, so an admission in this process cannot
    /// race the replay; recovery itself takes, renews and releases no lease. Records the store refuses (a newer fence,
    /// a released lease) are dead-lettered, never retried forever. Returns how many records were found. Blocking scan,
    /// then background tasks: a database outage does not delay startup or any tick.
    #[cfg(feature = "postgres")]
    pub fn recover_spooled(self: &Arc<Self>) -> usize {
        let Some(spool) = self.spool.clone() else {
            return 0;
        };
        let records = spool.scan();
        let dead_on_scan = spool.stats().dead_total;
        if dead_on_scan > 0 {
            self.inner.lock().expect("director").results_dead_lettered += dead_on_scan;
        }
        if !records.is_empty() {
            eprintln!(
                "[results] recovering {} spooled result(s) from {}",
                records.len(),
                spool.dir().display()
            );
        }
        let n = records.len();
        for (name, rec) in records {
            let key = ProfileKey::Durable(rec.profile_id);
            let match_id = rec.match_uuid().map(|u| *u.as_bytes()).unwrap_or([0; 16]);
            let gen = {
                let mut inner = self.inner.lock().expect("director");
                inner.gens += 1;
                let fresh = inner.gens;
                let seat = inner.profiles.entry(key.clone()).or_insert(ProfileSeat {
                    renewal: None,
                    gen: fresh,
                    match_id,
                    fence: rec.fence,
                    state: SeatState::Leaving,
                    result_due: false,
                    writes: 0,
                    lease: LeaseState::Gone,
                });
                seat.writes += 1;
                seat.gen
            };
            let spool = spool.clone();
            let d = self.clone();
            d.pending_writes
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            tokio::spawn(async move {
                d.drive_spooled(&spool, &name, &rec, true).await;
                let mut inner = d.inner.lock().expect("director");
                let mut mine = false;
                if let Some(s) = inner.profiles.get_mut(&key).filter(|s| s.gen == gen) {
                    s.writes -= 1;
                    mine = true;
                }
                if mine {
                    d.advance(&mut inner, &key);
                }
                drop(inner);
                d.pending_writes
                    .fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
            });
        }
        n
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

/// Reserves one slot in a room's command mailbox (bounded wait). `Ok(None)`: the room is already gone, so there is nobody to
/// tell and the book's own close handling covers the seats. `Err`: the mailbox stayed full, 503 (retry-safe: nothing has
/// changed yet).
pub(crate) async fn reserve_room_slot(
    tx: &tokio::sync::mpsc::Sender<RoomCmd>,
    wait: Duration,
) -> Result<Option<tokio::sync::mpsc::Permit<'_, RoomCmd>>, CtlError> {
    match tokio::time::timeout(wait, tx.reserve()).await {
        Ok(Ok(p)) => Ok(Some(p)),
        Ok(Err(_closed)) => Ok(None),
        Err(_) => Err(CtlError::new(
            503,
            "room_busy",
            "the room is not accepting commands right now; retry shortly",
        )),
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

    /// Protocol 8 admits the source lifecycle transport, so the director may be built for it; the full Wish profile is
    /// still refused before any runtime spawn.
    #[tokio::test]
    async fn arena_profile_director_construction_is_admitted_transport() {
        let sim = SimConfig {
            quests: false,
            consumables: true,
            lifecycle: rh_sim::ArenaMode::Source(Default::default()),
            ..Default::default()
        };
        assert!(crate::wire::profile_supported(&sim).is_ok());
        let director = Director::new(
            DirectorConfig::new(sim, rh_sim::arenas::practice_arena()),
            Arc::new(Persistence::Memory(Box::<MemoryStore>::default())),
            Arc::new(Auth::Dev),
            Arc::new(Lifecycle::default()),
        );
        drop(director);
    }

    #[test]
    #[should_panic(expected = "Full Wish casting requires")]
    fn wish_profile_director_construction_refuses_before_runtime_spawn() {
        let sim = SimConfig {
            consumables: true,
            abilities: rh_sim::abilities::Mode::Full,
            lifecycle: rh_sim::ArenaMode::Off,
            ..Default::default()
        };
        Director::new(
            DirectorConfig::new(sim, rh_sim::arenas::practice_arena()),
            Arc::new(Persistence::Memory(Box::<MemoryStore>::default())),
            Arc::new(Auth::Dev),
            Arc::new(Lifecycle::default()),
        );
    }

    fn director_with(store: MemoryStore) -> Arc<Director> {
        let sim = SimConfig {
            regen: false,
            training: false,
            dummies: false,
            consumables: true,
            abilities: rh_sim::abilities::Mode::Off,
            wish_lock_ms: rh_sim::abilities::WISH_LOCK_MS,
            hazards: rh_sim::terrain::Mode::Off,
            lifecycle: rh_sim::ArenaMode::Off,
            mob_mode: rh_sim::mob_runtime::MobMode::Off,
            initial_loot: false,
            min_players: 2,
            lobby_seconds: 30.0,
            fill_seconds: 0.0,
            pvp_rules: true,
            weapon_specials: true,
            faction_mode: rh_sim::FactionMode::Off,
            quests: false,
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

    #[tokio::test(start_paused = true)]
    async fn the_configured_fill_policy_reaches_a_spawned_room_with_the_room_s_fill_count() {
        let mut cfg = DirectorConfig::new(SimConfig::default(), rh_sim::arenas::practice_arena());
        cfg.bot_fill = Some(crate::bot_fill::BotFillConfig {
            fill_to: 99,
            arrival_seconds: 3.,
            ..crate::bot_fill::BotFillConfig::default()
        });
        let d = Director::new(
            cfg,
            Arc::new(Persistence::Memory(Box::<MemoryStore>::default())),
            Arc::new(Auth::Dev),
            Arc::new(Lifecycle::default()),
        );
        let fill = d
            .fill_policy(4)
            .expect("the configured fill reaches the room");
        assert_eq!(
            fill.fill_to, 4,
            "the room's fill count overrides the default"
        );
        assert_eq!(fill.arrival_seconds, 3.);
        assert!(
            director().fill_policy(4).is_none(),
            "without a configured fill the room keeps its placeholder fill"
        );
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
            ticket: Vec::new(),
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
            renewal: None,
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
        d.inner
            .lock()
            .unwrap()
            .profiles
            .get(&ProfileKey::from(key))
            .cloned()
    }

    fn some_result(profile: &str) -> rh_sim::RunResult {
        rh_sim::RunResult {
            faction: None,
            weapon: None,
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

    #[tokio::test(start_paused = true)]
    async fn ending_metadata_is_retained_for_humans_and_never_banks_a_bot() {
        let d = director_with(MemoryStore::strict());
        let m = id(1);
        let fence = d.persistence.acquire("subject", m).await.unwrap();
        d.inner
            .lock()
            .unwrap()
            .profiles
            .insert("subject".into(), seat(1, m, fence, SeatState::Seated));
        let mut result = some_result("subject");
        result.faction = Some(FactionId::Frost);
        result.weapon = Some(rh_sim::WeaponId::Wand);
        for bot in [true, false] {
            d.reports
                .send(RoomReport::Result {
                    admission: None,
                    match_id: m,
                    profile: "subject".into(),
                    fence: Some(fence),
                    bot,
                    result: result.clone(),
                    roster: Roster::default(),
                })
                .unwrap();
            settle().await;
            let stored = store(&d).results.lock().unwrap();
            if bot {
                assert!(stored.is_empty());
            } else {
                assert_eq!(stored.len(), 1);
                assert_eq!(stored[0].2, result);
            }
        }
    }

    #[test]
    fn lease_policy_reserves_time_for_a_renewal() {
        let default = LeasePolicy::default();
        assert!(default.validate().is_ok());
        assert!(LeasePolicy {
            ttl: Duration::from_secs(3600),
            ..default
        }
        .validate()
        .is_ok());
        for bad in [
            LeasePolicy {
                ttl: Duration::ZERO,
                ..default
            },
            LeasePolicy {
                renew_interval: Duration::ZERO,
                ..default
            },
            LeasePolicy {
                db_timeout: Duration::ZERO,
                ..default
            },
            LeasePolicy {
                ttl: default.renew_interval + default.db_timeout,
                ..default
            },
            LeasePolicy {
                ttl: Duration::from_secs(3601),
                ..default
            },
            LeasePolicy {
                ttl: Duration::from_secs(10_000_000_000_000),
                ..default
            },
            LeasePolicy {
                ttl: Duration::MAX,
                ..default
            },
        ] {
            assert!(bad.validate().is_err());
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_late_renewal_completion_cannot_change_a_replacement_generation() {
        let d = director_with(MemoryStore {
            renew_delay: Duration::from_secs(2),
            ..MemoryStore::strict()
        });
        let policy = d.cfg.leases;
        let old = d
            .persistence
            .acquire_for("archer", id(1), policy.ttl)
            .await
            .unwrap();
        d.inner.lock().unwrap().profiles.insert(
            "archer".into(),
            seat(1, id(1), old.fence, SeatState::Seated),
        );
        let start = tokio::time::Instant::now();
        let (tx, old_clock) = tokio::sync::watch::channel(start + policy.ttl);
        d.start_renewals("archer".into(), 1, id(1), old, start, tx);
        settle().await;
        tokio::time::advance(policy.renew_interval).await;
        settle().await;
        // The old query is outstanding. A new owner has acquired a fresh fence for this name.
        assert!(d.persistence.release("archer", old.fence).await.unwrap());
        let new = d
            .persistence
            .acquire_for("archer", id(2), policy.ttl)
            .await
            .unwrap();
        d.inner.lock().unwrap().profiles.insert(
            "archer".into(),
            seat(2, id(2), new.fence, SeatState::Seated),
        );
        let expiry = store(&d).lease("archer").unwrap().expires_at;
        tokio::time::advance(Duration::from_secs(2)).await;
        settle().await;
        assert_eq!(
            *old_clock.borrow(),
            start + policy.ttl,
            "obsolete false result must be ignored"
        );
        assert_eq!(store(&d).lease("archer").unwrap().expires_at, expiry);
        assert_eq!(entry_of(&d, "archer").unwrap().gen, 2);
    }

    #[tokio::test(start_paused = true)]
    async fn a_seat_that_left_keeps_renewing_until_a_slow_result_commits() {
        let d = director_with(MemoryStore {
            record_delay: Duration::from_secs(250),
            ..MemoryStore::strict()
        });
        let m = id(1);
        let lease = d
            .persistence
            .acquire_for("archer", m, d.cfg.leases.ttl)
            .await
            .unwrap();
        let start = tokio::time::Instant::now();
        let (tx, _clock) = tokio::sync::watch::channel(start + d.cfg.leases.ttl);
        d.inner
            .lock()
            .unwrap()
            .profiles
            .insert("archer".into(), seat(7, m, lease.fence, SeatState::Seated));
        d.start_renewals("archer".into(), 7, m, lease, start, tx);
        let worker = entry_of(&d, "archer").unwrap().renewal.unwrap();
        d.reports
            .send(RoomReport::Left {
                admission: None,
                match_id: m,
                profile: "archer".into(),
                fence: lease.fence,
                result_pending: true,
            })
            .unwrap();
        settle().await;
        // A pending room report also keeps the lease through an entire initial TTL.
        for _ in 0..5 {
            tokio::time::advance(d.cfg.leases.renew_interval).await;
            settle().await;
        }
        assert!(d.persistence.acquire("archer", id(2)).await.is_err());
        d.reports
            .send(RoomReport::Result {
                admission: None,
                match_id: m,
                profile: "archer".into(),
                fence: Some(lease.fence),
                bot: false,
                result: some_result("archer"),
                roster: Roster::default(),
            })
            .unwrap();
        settle().await;
        for _ in 0..7 {
            tokio::time::advance(d.cfg.leases.renew_interval).await;
            settle().await;
        }
        assert_eq!(entry_of(&d, "archer").unwrap().writes, 1);
        assert!(d.persistence.acquire("archer", id(2)).await.is_err());
        tokio::time::advance(Duration::from_secs(40)).await;
        settle().await;
        assert_eq!(store(&d).results.lock().unwrap().len(), 1);
        assert!(entry_of(&d, "archer").is_none());
        assert!(
            worker.is_finished(),
            "retired ownership cancels its sleeping worker immediately"
        );
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
            tokio::time::timeout(
                Duration::from_millis(1),
                d.wait_while_leaving(&ProfileKey::from(k), soon()),
            )
            .await
            .expect("returns at once");
        }
        // A leaving profile is waited for until it is freed.
        let waiter = {
            let d = d.clone();
            let deadline = soon();
            tokio::spawn(async move { d.wait_while_leaving(&"papa".into(), deadline).await })
        };
        settle().await;
        assert!(!waiter.is_finished(), "still mid-release");
        d.free(&"papa".into(), 1);
        waiter.await.unwrap();
        assert!(entry_of(&d, "papa").is_none());
        // A release that never lands ends the wait at the bound (the caller then refuses as in use).
        d.inner
            .lock()
            .unwrap()
            .profiles
            .insert("papa".into(), seat(4, m, 1, SeatState::Leaving));
        let t0 = tokio::time::Instant::now();
        d.wait_while_leaving(&"papa".into(), soon()).await;
        assert_eq!(t0.elapsed(), LEAVING_WAIT);
        // Another owner's free does not free this entry.
        d.free(&"papa".into(), 1);
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
                admission: None,
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
                admission: None,
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
        assert!(
            !inner.profiles.contains_key(&"papa".into()),
            "free once written"
        );
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
        d.free(&"papa".into(), 6);
        let e = entry_of(&d, "papa").expect("kept while the write is in flight");
        assert_eq!((e.writes, e.lease), (1, LeaseState::Gone));
        d.inner
            .lock()
            .unwrap()
            .profiles
            .get_mut(&ProfileKey::from("papa"))
            .unwrap()
            .writes = 0;
        d.free(&"papa".into(), 6);
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
                admission: None,
                match_id: m,
                profile: "papa".into(),
                fence,
                result_pending: true,
            })
            .unwrap();
        d.reports
            .send(RoomReport::Result {
                admission: None,
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
        assert!(!inner.profiles.contains_key(&"papa".into()), "free at once");
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
        d.unwind(&"papa".into(), 4, m, None);
        d.unwind(&"papa".into(), 4, m, Some(3));
        d.free(&"papa".into(), 4);
        settle().await;
        assert_eq!(
            entry_of(&d, "papa").map(|e| (e.gen, e.state)),
            Some((5, SeatState::Reserved))
        );
        // Its own admission unwinds it: with a lease taken it stays `Leaving` until the give-back lands.
        let fence = d.persistence.acquire("papa", m).await.unwrap();
        d.unwind(&"papa".into(), 5, m, Some(fence));
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
                admission: None,
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
                admission: None,
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

    #[tokio::test(start_paused = true)]
    async fn cancelling_after_join_was_seated_retires_the_exact_seat_and_reservation() {
        let d = director_with(MemoryStore::strict());
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
        let now = tokio::time::Instant::now();
        let mut room = Room::new(
            m,
            RoomConfig {
                sim: d.cfg.sim.clone(),
                arena: d.map.arena.clone(),
                welcome_map: d.map.welcome_map.clone(),
                fill_bots_to: 0,
                tick: d.cfg.tick,
                record: false,
                fixed_secrets: None,
                fixed_bot_seed: None,
                reconnect_grace: d.cfg.reconnect_grace,
                linger: d.cfg.linger,
            },
            d.reports.clone(),
            now,
        );
        let cloned = d.clone();
        let out = Arc::new(Outbox::default());
        let connection = out.clone();
        let attempt =
            tokio::spawn(async move { cloned.admit(hello("Archer"), connection, 1).await });
        let mut command = rx.recv().await.expect("join");
        let RoomCmd::JoinLeased { reply, .. } = &mut command else {
            panic!("expected leased join")
        };
        let (intercept, joined) = oneshot::channel();
        let delayed = std::mem::replace(reply, intercept);
        room.handle(command, now);
        let granted = joined.await.unwrap().expect("real room seated the human");
        attempt.abort();
        assert!(attempt.await.is_err());
        let _ = delayed.send(Ok(granted));
        settle().await;
        room.wake(now + d.cfg.tick);
        settle().await;
        assert_eq!(out.drain_into(&mut vec![]).close, Some(RejectCode::Kicked));
        assert!(entry_of(&d, "archer").is_none());
        assert!(store(&d).lease("Archer").unwrap().released);
        assert!(store(&d).results.lock().unwrap().is_empty());
        assert!(d
            .admit(hello("Archer"), Arc::new(Outbox::default()), 2)
            .await
            .is_ok());
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
        let Some(RoomCmd::JoinLeased { reply, .. }) = rx.recv().await else {
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
                admission: None,
                match_id: m,
                profile: "papa".into(),
                fence: f2,
                result_pending: true,
            })
            .unwrap();
        d.reports
            .send(RoomReport::Result {
                admission: None,
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

    #[tokio::test(start_paused = true)]
    async fn a_full_room_mailbox_is_a_503_and_a_closed_one_means_nobody_to_tell() {
        let (tx, rx) = mpsc::channel::<RoomCmd>(1);
        tx.send(RoomCmd::Drain).await.unwrap();
        let e = reserve_room_slot(&tx, Duration::from_secs(2))
            .await
            .map(|_| ())
            .unwrap_err();
        assert_eq!((e.status, e.code), (503, "room_busy"));
        // Space frees: the reservation succeeds and its send cannot fail.
        let mut rx = rx;
        rx.recv().await.unwrap();
        let permit = reserve_room_slot(&tx, Duration::from_secs(2))
            .await
            .unwrap()
            .expect("slot");
        permit.send(RoomCmd::Drain);
        assert!(matches!(rx.recv().await, Some(RoomCmd::Drain)));
        drop(rx);
        assert!(reserve_room_slot(&tx, Duration::from_secs(2))
            .await
            .unwrap()
            .is_none());
    }

    #[test]
    #[should_panic(expected = "no public admission route")]
    fn matchmaking_refuses_a_training_profile() {
        refuse_training_profile(&rh_sim::SimConfig {
            training: true,
            ..Default::default()
        });
    }
}
