//! One match: a task that owns its [`Sim`], its seats and its pacer. Everything that touches the simulation happens on this
//! task, in arrival order, between steps (the legacy rule: handlers validate and enqueue, the sim consumes at the next step).
//! Nothing here blocks on I/O: frames go to per-connection [`Outbox`]es, results to a channel drained off-tick.

use crate::metrics::{self, Histogram, Metrics};
use crate::outbox::{Outbox, OutboxCounters};
use crate::pacer::Pacer;
use crate::wire;
use rh_policy::{drive_seats_with, scripted, MatchStart, Seat};
use rh_protocol::map::{EncodedMap, MapBlob};
use rh_protocol::{encode_welcome, RejectCode, ServerMsg, WelcomeHeader, WireEvent, WireResult};
use rh_sim::replay::{BotPolicy, Recorder, Replay, ReplayInput, ReplayStart};
use rh_sim::{
    Arena, Event, FactionId, Phase, PlayerId, RunResult, Secrets, SeenEvent, Sim, SimConfig,
};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;

/// Seconds a dropped player's seat is held for a reconnect (legacy reconnect grace).
pub const RECONNECT_GRACE: Duration = Duration::from_secs(10);
/// A finished match stays up this long so clients receive the end and their results.
pub const LINGER: Duration = Duration::from_secs(5);
pub const INBOUND_CAP: usize = 2048;
/// A room nobody has joined yet waits this long for its first player (admission may still be acquiring a durable lease)
/// before closing itself.
pub const UNCLAIMED_TIMEOUT: Duration = Duration::from_secs(30);

pub type MatchId = [u8; 16];

/// The canonical UUID text of a match id (the form the durable store and replay headers use).
pub fn match_id_string(id: MatchId) -> String {
    let h: String = id.iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

/// Who was in a match, for its durable record (`matches.humans` / `matches.bots`): humans that ever took a seat, bots
/// that were placed.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Roster {
    pub humans: u32,
    pub bots: u32,
}

pub struct JoinOk {
    pub player: PlayerId,
    pub session: [u8; 16],
    pub welcome: Vec<u8>,
    /// The room's latest simulation time (f64 bits), for Pong.
    pub clock: Arc<AtomicU64>,
}

/// The admission that produced a seat. Durable identity and generation survive
/// resume, departure, and deferred reports; callsigns are only display names.
#[derive(Clone, Copy, Debug)]
pub struct Admission {
    pub gen: u64,
    pub profile_id: Option<i64>,
}

pub enum RoomCmd {
    /// `conn` identifies the connection (unique per process); `fence` is the profile's session-lease fence.
    Join {
        profile: String,
        faction: Option<FactionId>,
        outbox: Arc<Outbox>,
        conn: u64,
        fence: i64,
        reply: oneshot::Sender<Result<JoinOk, RejectCode>>,
    },
    /// A durable admission. This deadline belongs to this exact seat, including after any resume.
    JoinLeased {
        admission: Admission,
        profile: String,
        faction: Option<FactionId>,
        outbox: Arc<Outbox>,
        conn: u64,
        fence: i64,
        deadline: tokio::sync::watch::Receiver<Instant>,
        reply: oneshot::Sender<Result<JoinOk, RejectCode>>,
    },
    Resume {
        session: [u8; 16],
        outbox: Arc<Outbox>,
        conn: u64,
        reply: oneshot::Sender<Result<JoinOk, RejectCode>>,
    },
    /// Commands from a connection that is no longer the seat's (it was replaced by a resume) are ignored.
    Input {
        player: PlayerId,
        conn: u64,
        seq: u32,
        commands: Vec<rh_protocol::WireCommand>,
    },
    Disconnected {
        player: PlayerId,
        conn: u64,
    },
    Leave {
        player: PlayerId,
        conn: u64,
    },
    Drain,
    /// The hosting layer revoked this seat (control API `leave` mode `kick`): the same path as a disconnect past the grace.
    /// The profile is matched ASCII case-insensitively; an unknown profile is ignored.
    Kick {
        profile: String,
    },
    /// The hosting layer ends the room now (control API `end` mode `abort`): seated players are closed out and their seats
    /// and leases freed, and no result is invented for an interrupted match.
    Abort,
    /// Tests: the room task panics (the crash path).
    #[cfg(test)]
    Crash,
}

/// What the room reports to its owner (the director): free a profile, a result to persist, the room closed.
#[derive(Debug)]
pub enum RoomReport {
    /// A human left its seat. `result_pending`: it left a run it was still standing in, so its (MIA) result follows in a
    /// `Result` report; the director keeps the profile reserved until that result is written.
    Left {
        admission: Option<Admission>,
        match_id: MatchId,
        profile: String,
        fence: i64,
        result_pending: bool,
    },
    /// `fence`: the session-lease fence the result was earned under (None for a bot).
    Result {
        admission: Option<Admission>,
        match_id: MatchId,
        profile: String,
        bot: bool,
        fence: Option<i64>,
        result: RunResult,
        roster: Roster,
    },
    Closed {
        match_id: MatchId,
        stats: RoomStats,
        final_hash: u64,
        replay: Option<Box<Replay>>,
    },
    /// A human took a seat (its Join reply follows this report): `humans` is the room's seated count. The director counts
    /// the admission as seated from here on; until then it was only a reservation (an admission that may still be
    /// acquiring its durable lease).
    Seated {
        match_id: MatchId,
        phase: Phase,
        humans: usize,
    },
    /// The room's phase changed (a lobby that closed into a run must stop receiving joins).
    Phase { match_id: MatchId, phase: Phase },
    /// One human's seat changed state, for the control API's player list (docs/hosting/CONTROL_API.md section 3.4). Sent
    /// in the same channel as `Left`, so it is ordered with the seat's other reports. It carries no lease logic.
    Seat {
        match_id: MatchId,
        profile: String,
        event: SeatEvent,
    },
}

/// What happened to a human's seat (see [`RoomReport::Seat`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SeatEvent {
    Seated,
    /// The connection dropped at `at`; the seat is held for the reconnect grace.
    Away {
        at: Instant,
    },
    /// A resume (the 16-byte token) re-attached a connection inside the grace.
    Back,
    /// Final: the seat is gone.
    Gone(GoneReason),
}

/// Why a seat is gone (the control API's `reason` of a `left` player).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GoneReason {
    /// The connection stayed away longer than the reconnect grace.
    GraceExpired,
    /// A clean leave.
    Left,
    /// Revoked by the hosting layer.
    Kicked,
    /// The room closed with the player still seated (after its results were delivered).
    MatchOver,
    /// The durable lease the seat ran under lapsed (the seat is no longer authorised).
    LeaseExpired,
    /// The hosting layer aborted the room.
    Aborted,
}

impl GoneReason {
    pub fn as_str(self) -> &'static str {
        match self {
            GoneReason::GraceExpired => "grace_expired",
            GoneReason::Left => "left",
            GoneReason::Kicked => "kicked",
            GoneReason::MatchOver => "match_over",
            GoneReason::LeaseExpired => "lease_expired",
            GoneReason::Aborted => "aborted",
        }
    }
}

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomStats {
    pub ticks: u64,
    /// Step wall-time quantiles in microseconds, from a log-linear histogram: p50 and p99 are bucket upper bounds (never
    /// below the true value, at most 25% above it); the max is exact.
    pub step_us_p50: u64,
    pub step_us_p99: u64,
    pub step_us_max: u64,
    pub late_wakes: u64,
    pub dropped_steps: u64,
    /// Bytes the room handed to its humans' outboxes: events and fx frames, and each snapshot at a lower bound of the size of
    /// its Full frame (the connection's writer encodes it, as a delta when it can: `snapshot_bytes_sent` has the real bytes).
    pub bytes_out: u64,
    /// Bytes of the frames the outboxes accepted (at most `bytes_out`: a closed outbox takes nothing).
    pub bytes_enqueued_total: u64,
    /// Fx frames evicted unsent from slow clients' outboxes, over every connection the match had.
    pub fx_dropped: u64,
    /// Snapshots a slow client skipped because a newer one replaced them.
    pub snapshots_skipped: u64,
    /// Snapshot frames the connections' writers encoded as Full frames and as deltas (protocol v3), and their bytes: what the
    /// snapshots cost on the wire.
    pub snapshots_full: u64,
    pub snapshots_delta: u64,
    pub snapshot_bytes_sent: u64,
    /// Snapshots the encoder refused to send (never a repaired frame): counted here, logged once per room.
    pub snapshot_refusals: u64,
    /// Refusal log lines printed: at most one per room, however many refusals there were.
    pub snapshot_refusals_logged: u64,
    /// Events and Fx frames the encoder refused (never a clamped or repaired frame): counted, logged once per room.
    pub frame_refusals: u64,
    pub frame_refusals_logged: u64,
    /// The room task panicked: these are the stats it had, reported by its unwinding guard.
    pub crashed: bool,
}

/// What every room of one map shares: the immutable arena and its Welcome map blob, RLE-encoded once. The director builds
/// one per map; a room only clones the `Arc`s.
#[derive(Clone)]
pub struct MapAssets {
    pub arena: Arc<Arena>,
    pub welcome_map: Arc<EncodedMap>,
}

impl MapAssets {
    /// Fails (with the protocol's reason) for a map a client would refuse to decode.
    pub fn new(arena: impl Into<Arc<Arena>>) -> Result<Self, rh_protocol::EncodeError> {
        let arena = arena.into();
        let m = &arena.map;
        let welcome_map = MapBlob::new(m.w as u16, m.h as u16, m.tiles.clone()).pre_encode()?;
        Ok(Self {
            arena,
            welcome_map: Arc::new(welcome_map),
        })
    }
}

pub struct RoomConfig {
    pub sim: SimConfig,
    /// Shared by every room of the map (never cloned per room).
    pub arena: Arc<Arena>,
    /// The map's Welcome blob (see [`MapAssets`]); every join and resume copies these bytes.
    pub welcome_map: Arc<EncodedMap>,
    /// Fill the match with scripted bots up to this many players (0: none).
    pub fill_bots_to: usize,
    pub tick: Duration,
    /// Record a private replay of the match (every input, every step's state hash).
    pub record: bool,
    /// Tests only: fixed match secrets and bot seeds (live rooms draw both from the OS CSPRNG).
    pub fixed_secrets: Option<Secrets>,
    pub fixed_bot_seed: Option<u64>,
    pub reconnect_grace: Duration,
    pub linger: Duration,
}

/// Retained after leave so a delayed result still names its exact admitted owner.
struct SeatRecord {
    player: PlayerId,
    fence: Option<i64>,
    admission: Option<Admission>,
}

struct HumanSeat {
    fx: rh_sim::FxProjector,
    admission: Option<Admission>,
    deadline: Option<tokio::sync::watch::Receiver<Instant>>,
    player: PlayerId,
    conn: u64,
    fence: i64,
    profile: String,
    session: [u8; 16],
    outbox: Option<Arc<Outbox>>,
    dropped_at: Option<Instant>,
    ack_input: u32,
    /// What this human could know of the wake's steps before the last, judged step by step as they ran (empty between
    /// wakes and on every one-step wake).
    carry: Vec<SeenEvent>,
    /// A snapshot the connection's outbox handed back, to build the next one in (no allocation per tick).
    spare: Option<rh_protocol::SnapshotData>,
    /// This player's own resolved run, kept on the seat so a client that was away when it resolved (the reconnect grace, or a
    /// TooSlow close that dropped its queued events) still receives it: it is re-sent after a resume's Welcome (protocol v4,
    /// docs/adr/0011-protocol-v4.md).
    result: Option<WireResult>,
}

pub struct Room {
    pub id: MatchId,
    sim: Sim,
    humans: Vec<HumanSeat>,
    bots: Vec<Seat>,
    fill_to: usize,
    pacer: Pacer,
    /// The last step's events (the bots' input to their next decision, and the observation's events when published). Two
    /// buffers swap through `step_into` each step: the room allocates no event list per step.
    last_events: Vec<Event>,
    step_events: Vec<Event>,
    /// Every event of the current wake, in order (reused).
    wake_events: Vec<Event>,
    publisher: wire::Publisher,
    /// The bots' line-of-sight memo (derived, outside the sim; the publisher keeps its own for the humans).
    bot_sight: rh_sim::SightCache,
    reports: mpsc::UnboundedSender<RoomReport>,
    clock: Arc<AtomicU64>,
    /// Step wall times: a fixed-size histogram (384 bytes at any uptime; was a Vec growing to 288 KB).
    step_us: Histogram,
    metrics: &'static Metrics,
    bytes_out: u64,
    snapshot_refusals: u64,
    snapshot_refusals_logged: u64,
    frame_refusals: u64,
    frame_refusals_logged: u64,
    ended_at: Option<Instant>,
    draining: bool,
    welcome_map: Arc<EncodedMap>,
    /// Counters of the outboxes this room no longer holds (a resumed, dropped or left connection's).
    retired_outboxes: OutboxCounters,
    bot_seq: u64,
    recorder: Option<Recorder>,
    fixed_bot_seed: Option<u64>,
    reconnect_grace: Duration,
    linger: Duration,
    opened_at: Instant,
    had_human: bool,
    /// Every human's lease fence, kept after it leaves: its result may be reported a step later.
    fences: Vec<SeatRecord>,
    reported_phase: Phase,
    /// The room reported `Closed` (the task must end).
    closed: bool,
    /// Tests: wall time every wake burns (an overloaded host).
    #[cfg(test)]
    stall: Duration,
}

pub fn random16() -> [u8; 16] {
    let mut b = [0u8; 16];
    getrandom::getrandom(&mut b).expect("OS entropy");
    b
}

fn random_u32() -> u32 {
    let mut b = [0u8; 4];
    getrandom::getrandom(&mut b).expect("OS entropy");
    u32::from_le_bytes(b)
}

impl Room {
    pub fn new(
        id: MatchId,
        cfg: RoomConfig,
        reports: mpsc::UnboundedSender<RoomReport>,
        now: Instant,
    ) -> Self {
        // Match secrets come from the OS CSPRNG and never leave this task (docs/CONTRACTS.md C-RNG).
        let secrets = cfg.fixed_secrets.unwrap_or_else(|| Secrets {
            order_salt: random_u32(),
            spawn_seed: random_u32(),
        });
        let sim = Sim::new(cfg.sim.clone(), cfg.arena, secrets);
        let recorder = cfg.record.then(|| {
            let mut r = Recorder::new(&sim, cfg.sim, ReplayStart::Lobby);
            r.replay.match_id = Some(match_id_string(id));
            r
        });
        Self {
            id,
            sim,
            humans: Vec::new(),
            bots: Vec::new(),
            fill_to: cfg.fill_bots_to,
            pacer: Pacer::new(now, cfg.tick),
            last_events: Vec::new(),
            step_events: Vec::new(),
            wake_events: Vec::new(),
            publisher: wire::Publisher::default(),
            bot_sight: rh_sim::SightCache::new(),
            reports,
            clock: Arc::new(AtomicU64::new(0f64.to_bits())),
            step_us: Histogram::new(),
            metrics: metrics::process(),
            bytes_out: 0,
            snapshot_refusals: 0,
            snapshot_refusals_logged: 0,
            frame_refusals: 0,
            frame_refusals_logged: 0,
            ended_at: None,
            draining: false,
            welcome_map: cfg.welcome_map,
            retired_outboxes: OutboxCounters::default(),
            bot_seq: 0,
            recorder,
            fixed_bot_seed: cfg.fixed_bot_seed,
            reconnect_grace: cfg.reconnect_grace,
            linger: cfg.linger,
            opened_at: now,
            had_human: false,
            fences: Vec::new(),
            reported_phase: Phase::Lobby,
            closed: false,
            #[cfg(test)]
            stall: Duration::ZERO,
        }
    }

    /// Reports to `metrics` instead of the process-wide counters (tests and benches that need isolated numbers).
    pub fn with_metrics(mut self, metrics: &'static Metrics) -> Self {
        self.metrics = metrics;
        self
    }

    fn record(&mut self, input: ReplayInput) {
        if let Some(r) = self.recorder.as_mut() {
            r.record(input);
        }
    }

    pub fn sim(&self) -> &Sim {
        &self.sim
    }

    fn welcome(&self, player: PlayerId, session: [u8; 16]) -> Vec<u8> {
        // The map is copied from its once-encoded blob, not run-length encoded per join and resume.
        encode_welcome(
            &WelcomeHeader {
                protocol: rh_protocol::PROTOCOL_VERSION,
                content_hash: rh_sim::content::content_hash(),
                match_id: self.id,
                player_id: player.0,
                session,
                tick_rate: rh_sim::constants::TICK_RATE as u8,
                tick: self.sim.tick(),
                server_ms: self.sim.server_time(),
            },
            &self.welcome_map,
        )
    }

    /// Takes a connection's counters into the room's totals once the room stops pushing to it.
    fn retire_outbox(&mut self, o: &Outbox) {
        self.retired_outboxes.add(o.counters());
    }

    fn humans_present(&self) -> usize {
        self.humans.len()
    }

    pub fn handle(&mut self, cmd: RoomCmd, now: Instant) {
        let now = now.max(Instant::now());
        self.expire_leases(now);
        match cmd {
            RoomCmd::Join {
                profile,
                faction,
                outbox,
                conn,
                fence,
                reply,
            } => {
                let r = self.join(profile, faction, outbox, conn, fence, None);
                let _ = reply.send(r);
            }
            RoomCmd::JoinLeased {
                admission,
                profile,
                faction,
                outbox,
                conn,
                fence,
                deadline,
                reply,
            } => {
                let result = if *deadline.borrow() <= now {
                    Err(RejectCode::ProfileInUse)
                } else {
                    self.join(
                        profile,
                        faction,
                        outbox,
                        conn,
                        fence,
                        Some((admission, deadline)),
                    )
                };
                let _ = reply.send(result);
            }
            RoomCmd::Resume {
                session,
                outbox,
                conn,
                reply,
            } => {
                let r = match self.humans.iter_mut().find(|h| h.session == session) {
                    None => Err(RejectCode::NoSuchSession),
                    Some(h) => {
                        let old = h.outbox.replace(outbox.clone());
                        // From now on only the new connection speaks for this seat.
                        h.conn = conn;
                        h.dropped_at = None;
                        h.fx.rebind(&self.sim, h.player);
                        h.carry.clear();
                        let (player, session) = (h.player, h.session);
                        let seat_profile = h.profile.clone();
                        let resolved = h.result.clone();
                        if let Some(old) = old {
                            old.close(RejectCode::Kicked);
                            self.retire_outbox(&old);
                        }
                        self.record(ReplayInput::Dropped {
                            player,
                            dropped: false,
                        });
                        self.sim.mark_dropped(player, false);
                        let _ = self.reports.send(RoomReport::Seat {
                            match_id: self.id,
                            profile: seat_profile,
                            event: SeatEvent::Back,
                        });
                        // The run this player already resolved: the one reliable event that is not state the client can read
                        // back, so it is queued behind the Welcome (which the connection writes first).
                        if let Some(r) = resolved {
                            let frame = ServerMsg::Events {
                                tick: self.sim.tick(),
                                events: vec![WireEvent::Result(r)],
                            }
                            .try_encode();
                            if let Ok(frame) = frame {
                                outbox.important(frame);
                            }
                        }
                        // A fresh Welcome is the resync: full map and the current tick; the next snapshot follows.
                        Ok(JoinOk {
                            player,
                            session,
                            welcome: self.welcome(player, session),
                            clock: self.clock.clone(),
                        })
                    }
                };
                let _ = reply.send(r);
            }
            RoomCmd::Input {
                player,
                conn,
                seq,
                commands,
            } => {
                let mut ok = false;
                if let Some(h) = self
                    .humans
                    .iter_mut()
                    .find(|h| h.player == player && h.conn == conn)
                {
                    h.ack_input = seq;
                    ok = true;
                }
                if ok {
                    for c in commands {
                        // Validation and the order budget are the sim's (the same path as bots and policies).
                        if let Ok(cmd) = rh_sim::validate(wire::command(c)) {
                            self.record(ReplayInput::Command { player, cmd });
                            let _ = self.sim.submit(player, cmd);
                        }
                    }
                }
            }
            RoomCmd::Disconnected { player, conn } => {
                // A replaced connection's late disconnect must not detach the seat its resume took over.
                if let Some(h) = self
                    .humans
                    .iter_mut()
                    .find(|h| h.player == player && h.conn == conn)
                {
                    let old = h.outbox.take();
                    h.dropped_at = Some(now);
                    self.record(ReplayInput::Dropped {
                        player,
                        dropped: true,
                    });
                    self.sim.mark_dropped(player, true);
                    if let Some(old) = old {
                        self.retire_outbox(&old);
                    }
                    if let Some(h) = self.humans.iter().find(|h| h.player == player) {
                        let _ = self.reports.send(RoomReport::Seat {
                            match_id: self.id,
                            profile: h.profile.clone(),
                            event: SeatEvent::Away { at: now },
                        });
                    }
                }
            }
            RoomCmd::Leave { player, conn } => {
                if self
                    .humans
                    .iter()
                    .any(|h| h.player == player && h.conn == conn)
                {
                    self.leave(player, GoneReason::Left);
                }
            }
            RoomCmd::Kick { profile } => {
                if let Some(player) = self
                    .humans
                    .iter()
                    .find(|h| h.profile.eq_ignore_ascii_case(&profile))
                    .map(|h| h.player)
                {
                    self.leave(player, GoneReason::Kicked);
                }
            }
            RoomCmd::Abort => {
                self.finish(true);
            }
            RoomCmd::Drain => self.draining = true,
            #[cfg(test)]
            RoomCmd::Crash => panic!("test: the room task panics"),
        }
    }

    fn join(
        &mut self,
        profile: String,
        faction: Option<FactionId>,
        outbox: Arc<Outbox>,
        conn: u64,
        fence: i64,
        lease: Option<(Admission, tokio::sync::watch::Receiver<Instant>)>,
    ) -> Result<JoinOk, RejectCode> {
        if self.draining {
            return Err(RejectCode::ServerDraining);
        }
        if self.sim.phase() != Phase::Lobby {
            return Err(RejectCode::MatchFull);
        }
        // A human takes a bot's seat when the lobby is full (legacy: the newest bot yields).
        if self.sim.players().len() >= rh_sim::constants::MAX_PLAYERS {
            if let Some(bot) = self
                .sim
                .players()
                .iter()
                .rev()
                .find(|p| p.seat.bot)
                .map(|p| p.id)
            {
                self.record(ReplayInput::Leave { player: bot });
                self.sim.remove_player(bot);
                self.bots.retain(|s| s.player() != bot);
            }
        }
        let player = self
            .sim
            .add_player(&profile, faction, false)
            .ok_or(RejectCode::MatchFull)?;
        self.record(ReplayInput::Join {
            profile: profile.clone(),
            faction,
            bot: false,
            policy: None,
        });
        let session = random16();
        let admission = lease.as_ref().map(|(identity, _)| *identity);
        self.fences.push(SeatRecord {
            player,
            fence: Some(fence),
            admission,
        });
        // A room that has had a human closes the moment it has none again (see `wake`).
        self.had_human = true;
        self.humans.push(HumanSeat {
            fx: rh_sim::FxProjector::attach(&self.sim, player),
            admission,
            deadline: lease.map(|(_, deadline)| deadline),
            player,
            conn,
            fence,
            profile,
            session,
            outbox: Some(outbox),
            dropped_at: None,
            ack_input: 0,
            carry: Vec::new(),
            spare: None,
            result: None,
        });
        self.fill_bots();
        let _ = self.reports.send(RoomReport::Seated {
            match_id: self.id,
            phase: self.sim.phase(),
            humans: self.humans_present(),
        });
        if let Some(h) = self.humans.last() {
            let _ = self.reports.send(RoomReport::Seat {
                match_id: self.id,
                profile: h.profile.clone(),
                event: SeatEvent::Seated,
            });
        }
        Ok(JoinOk {
            player,
            session,
            welcome: self.welcome(player, session),
            clock: self.clock.clone(),
        })
    }

    /// Scripted bots on the same seat contract as future policies (rh-policy). Bots never close a lobby: only humans count.
    fn fill_bots(&mut self) {
        while self.humans_present() > 0 && self.sim.players().len() < self.fill_to {
            self.bot_seq += 1;
            let name = format!("bot{}", self.bot_seq);
            let Some(id) = self.sim.add_player(&name, None, true) else {
                break;
            };
            let seed = match self.fixed_bot_seed {
                Some(s) => s.wrapping_add(self.bot_seq),
                None => u64::from(random_u32()) << 32 | u64::from(random_u32()),
            };
            let interval = 2 + (self.bot_seq % 3) as u32;
            self.record(ReplayInput::Join {
                profile: name,
                faction: None,
                bot: true,
                policy: Some(BotPolicy {
                    name: "brawler".into(),
                    interval,
                    seed,
                }),
            });
            self.bots.push(Seat::new(
                &MatchStart::of(&self.sim, id, seed),
                Box::new(scripted::Brawler::new(interval)),
                Box::new(scripted::Idle),
            ));
            self.bots
                .last_mut()
                .expect("new bot")
                .bind_fx(&self.sim)
                .expect("new bot is unbound");
        }
    }

    /// Expire before processing commands and before stepping queued inputs. A committed result
    /// already ended this human's gameplay; its reliable delivery survives release of the lease.
    fn expire_leases(&mut self, now: Instant) {
        let mut i = 0;
        while i < self.humans.len() {
            let h = &self.humans[i];
            if h.deadline.as_ref().is_some_and(|d| *d.borrow() <= now)
                && h.result.is_none()
                && self.sim.player(h.player).is_some_and(|p| !p.resolved)
            {
                let id = h.player;
                if let Some(seat) = self.fences.iter_mut().find(|s| s.player == id) {
                    seat.fence = None; // This forced MIA is not authorized to bank a result.
                }
                self.leave(id, GoneReason::LeaseExpired);
            } else {
                i += 1;
            }
        }
    }

    fn leave(&mut self, player: PlayerId, why: GoneReason) {
        if let Some(i) = self.humans.iter().position(|h| h.player == player) {
            let h = self.humans.remove(i);
            if let Some(o) = h.outbox {
                o.close(RejectCode::Kicked);
                self.retire_outbox(&o);
            }
            // Leaving a run one still stands in is MIA: the sim resolves it now and its result is reported with the next
            // step's events; the director holds the profile until it is written.
            let result_pending = self
                .fences
                .iter()
                .any(|seat| seat.player == player && seat.fence.is_some())
                && self.sim.phase() == Phase::Active
                && self.sim.player(player).is_some_and(|p| !p.resolved);
            self.record(ReplayInput::Leave { player });
            self.sim.remove_player(player);
            let _ = self.reports.send(RoomReport::Seat {
                match_id: self.id,
                profile: h.profile.clone(),
                event: SeatEvent::Gone(why),
            });
            let _ = self.reports.send(RoomReport::Left {
                admission: h.admission,
                match_id: self.id,
                profile: h.profile,
                fence: h.fence,
                result_pending,
            });
        }
    }

    pub fn next_deadline(&self) -> Instant {
        self.pacer.next_deadline()
    }

    /// Runs the steps the grid owes and publishes once. Returns false when the room should close.
    pub fn wake(&mut self, now: Instant) -> bool {
        self.expire_leases(now);
        // Reconnect grace: a seat whose client did not come back is a leave (MIA in a run).
        let expired: Vec<PlayerId> = self
            .humans
            .iter()
            .filter(|h| {
                h.dropped_at
                    .is_some_and(|t| now.duration_since(t) >= self.reconnect_grace)
            })
            .map(|h| h.player)
            .collect();
        for p in expired {
            self.leave(p, GoneReason::GraceExpired);
        }
        if self.humans.is_empty()
            && self.sim.phase() != Phase::Ended
            && (self.had_human
                || self.draining
                || now.duration_since(self.opened_at) >= UNCLAIMED_TIMEOUT)
        {
            // Nobody left to play for: a lobby closes; a run's remaining players are all bots or gone. A room nobody has
            // joined yet waits for its first player (its admission may be acquiring a durable lease off the tick), unless
            // the server is draining: no admission can seat after that, so an empty room has nothing left to wait for.
            return self.close();
        }
        let slot = self.pacer.next_deadline();
        let dropped_before = self.pacer.dropped;
        let steps = self.pacer.due(now);
        if steps == 0 {
            return true;
        }
        #[cfg(test)]
        if !self.stall.is_zero() {
            std::thread::sleep(self.stall);
        }
        // One add per shared counter for this wake (the histograms add one bucket per value).
        self.metrics.wakes.fetch_add(1, Ordering::Relaxed);
        self.metrics
            .steps
            .fetch_add(u64::from(steps), Ordering::Relaxed);
        let dropped = self.pacer.dropped - dropped_before;
        if dropped > 0 {
            self.metrics
                .dropped_steps
                .fetch_add(dropped, Ordering::Relaxed);
        }
        self.metrics.note_wake(
            now.saturating_duration_since(slot),
            steps,
            self.pacer.period(),
        );
        self.wake_events.clear();
        for _ in 0..steps {
            let t = std::time::Instant::now();
            let rec = &mut self.recorder;
            drive_seats_with(
                &mut self.sim,
                &mut self.bots,
                &self.last_events,
                &mut self.bot_sight,
                |player, cmd| {
                    if let Some(r) = rec.as_mut() {
                        r.record(ReplayInput::Command { player, cmd });
                    }
                },
            );
            self.expire_leases(Instant::now().max(now));
            self.step_events.clear();
            self.sim.step_into(&mut self.step_events);
            let us = t.elapsed().as_micros().min(u32::MAX as u128) as u32;
            if let Some(r) = self.recorder.as_mut() {
                r.stepped(&self.sim);
            }
            self.step_us.record(us);
            self.metrics.step_us.record(us);
            rh_policy::feed_seats(&self.sim, &mut self.bots);
            for h in &mut self.humans {
                if h.outbox.is_none() {
                    h.fx.rebind(&self.sim, h.player);
                    h.carry.clear();
                    continue;
                }
                match h.fx.feed(self.sim.fx_report()).and_then(|status| {
                    if status != rh_sim::FeedStatus::Duplicate {
                        h.fx.append_into(&self.sim, h.player, &mut h.carry)?;
                    }
                    Ok(status)
                }) {
                    Ok(rh_sim::FeedStatus::Duplicate) => {}
                    Ok(_) => {}
                    Err(e) => {
                        h.carry.clear();
                        self.frame_refusals += 1;
                        if self.frame_refusals_logged == 0 {
                            self.frame_refusals_logged += 1;
                            eprintln!("[room] temporal projection refused: {e:?}");
                        }
                    }
                }
            }
            self.wake_events.extend_from_slice(&self.step_events);
            std::mem::swap(&mut self.last_events, &mut self.step_events);
        }
        self.clock
            .store(self.sim.server_time().to_bits(), Ordering::Relaxed);
        let t = std::time::Instant::now();
        // The buffer leaves the room for the call (publish borrows the room mutably) and comes back.
        let all_events = std::mem::take(&mut self.wake_events);
        self.keep_results(&all_events);
        self.publish(&all_events);
        self.metrics
            .publish_us
            .record(t.elapsed().as_micros().min(u128::from(u32::MAX)) as u32);
        self.report_results(&all_events);
        self.wake_events = all_events;
        if self.sim.phase() != self.reported_phase {
            // Every phase change reaches the director (a lobby that closed into a run must stop receiving joins).
            self.reported_phase = self.sim.phase();
            let _ = self.reports.send(RoomReport::Phase {
                match_id: self.id,
                phase: self.sim.phase(),
            });
        }
        if self.sim.phase() == Phase::Ended && self.ended_at.is_none() {
            self.ended_at = Some(now);
        }
        if let Some(t) = self.ended_at {
            if now.duration_since(t) >= self.linger {
                return self.close();
            }
        }
        true
    }

    /// One tick's frames for every connected human. `events`: every event of the wake; the observation's own events are
    /// those of the last step (`last_events`) plus what each human's `carry` gathered from the earlier steps.
    fn publish(&mut self, events: &[Event]) {
        // Shared counters get one add each per publish, however many humans the room has.
        let (mut bytes_total, mut pushes) = (0u64, 0u64);
        for h in &mut self.humans {
            let Some(out) = &h.outbox else {
                h.carry.clear();
                continue;
            };
            let frames = self.publisher.frames_in(
                h.spare.take(),
                &self.sim,
                h.player,
                h.ack_input,
                &[],
                &mut h.carry,
                events,
            );
            if let Some(e) = frames.refused {
                // An Events or Fx frame the codec refused: not sent (never clamped), counted, logged once per room.
                if self.frame_refusals == 0 {
                    self.frame_refusals_logged += 1;
                    eprintln!(
                        "[room] frame not sent: {e} (logged once per room; see frameRefusals)"
                    );
                }
                self.frame_refusals += 1;
            }
            let snap = match frames.snapshot {
                Ok(snap) => Some(snap),
                // Never a repaired frame: the viewer simply misses this snapshot (the next one supersedes it).
                Err(e) => {
                    // Logged once per room (the cause is per map and persists): the count is in the room's stats.
                    if self.snapshot_refusals == 0 {
                        self.snapshot_refusals_logged += 1;
                        eprintln!(
                            "[room] snapshot not sent: {e} (logged once per room; see snapshotRefusals)"
                        );
                    }
                    self.snapshot_refusals += 1;
                    None
                }
            };
            let bytes: usize = [&frames.important, &frames.fx]
                .into_iter()
                .flatten()
                .map(Vec::len)
                .sum::<usize>()
                + snap.as_ref().map_or(0, rh_protocol::SnapshotData::min_len);
            if bytes > 0 {
                self.bytes_out += bytes as u64;
                bytes_total += bytes as u64;
                pushes += 1;
                // One lock and one notify for the client's whole tick.
                h.spare = out.push_tick(frames.important, frames.fx, snap);
            }
        }
        if pushes > 0 {
            self.metrics
                .bytes_out
                .fetch_add(bytes_total, Ordering::Relaxed);
            self.metrics
                .outbox_pushes
                .fetch_add(pushes, Ordering::Relaxed);
        }
    }

    /// Keeps each human's own resolved result on its seat (see [`HumanSeat::result`]).
    fn keep_results(&mut self, events: &[Event]) {
        for e in events {
            if let Event::Resolved {
                id,
                result,
                bot: false,
            } = e
            {
                if let Some(h) = self.humans.iter_mut().find(|h| h.player == *id) {
                    h.result = Some(wire::result(result));
                }
            }
        }
    }

    /// Every resolved result goes to the director (durable storage), with the fence it was earned under.
    fn report_results(&self, events: &[Event]) {
        for e in events {
            if let Event::Resolved { id, result, bot } = e {
                let (fence, admission) = if *bot {
                    (None, None)
                } else {
                    let Some(seat) = self
                        .fences
                        .iter()
                        .find(|seat| seat.player == *id && seat.fence.is_some())
                    else {
                        continue;
                    };
                    (seat.fence, seat.admission)
                };
                let _ = self.reports.send(RoomReport::Result {
                    admission,
                    match_id: self.id,
                    profile: result.profile.clone(),
                    bot: *bot,
                    fence,
                    result: result.clone(),
                    roster: Roster {
                        humans: self.fences.len() as u32,
                        bots: self.bots.len() as u32,
                    },
                });
            }
        }
    }

    fn close(&mut self) -> bool {
        self.finish(false)
    }

    /// Closes the room. `interrupted` (the hosting layer's abort): events not yet reported are discarded, so no result is
    /// invented for a match that did not finish; seats and leases are freed exactly as for a normal close.
    fn finish(&mut self, interrupted: bool) -> bool {
        if self.closed {
            return false;
        }
        self.closed = true;
        // Results emitted between steps (the last human's MIA leave) would otherwise die with the room.
        let pending = self.sim.take_events();
        if !interrupted {
            self.report_results(&pending);
        }
        let why = if interrupted {
            GoneReason::Aborted
        } else {
            GoneReason::MatchOver
        };
        for h in std::mem::take(&mut self.humans) {
            let _ = self.reports.send(RoomReport::Seat {
                match_id: self.id,
                profile: h.profile.clone(),
                event: SeatEvent::Gone(why),
            });
            if let Some(o) = &h.outbox {
                o.close(RejectCode::Kicked);
                self.retire_outbox(o);
            }
            // A result this seat earned was reported above or earlier; the director keeps the profile until its write
            // lands (the write releases the lease), so `result_pending` stays about results still to come.
            let _ = self.reports.send(RoomReport::Left {
                admission: h.admission,
                match_id: self.id,
                profile: h.profile,
                fence: h.fence,
                result_pending: false,
            });
        }
        let replay = self.recorder.take().map(|r| Box::new(r.replay));
        let _ = self.reports.send(RoomReport::Closed {
            match_id: self.id,
            stats: self.stats(),
            final_hash: self.sim.state_hash(),
            replay,
        });
        false
    }

    /// The room reported `Closed`; its task must end.
    pub fn is_closed(&self) -> bool {
        self.closed
    }

    pub fn stats(&self) -> RoomStats {
        // Connections the room still holds count live; the ones it let go were folded in when it did.
        let mut outboxes = self.retired_outboxes;
        for o in self.humans.iter().filter_map(|h| h.outbox.as_deref()) {
            outboxes.add(o.counters());
        }
        RoomStats {
            ticks: self.step_us.count(),
            step_us_p50: self.step_us.quantile(0.5),
            step_us_p99: self.step_us.quantile(0.99),
            step_us_max: self.step_us.max(),
            late_wakes: self.pacer.late_wakes,
            dropped_steps: self.pacer.dropped,
            bytes_out: self.bytes_out,
            bytes_enqueued_total: outboxes.bytes_enqueued_total,
            fx_dropped: outboxes.fx_dropped,
            snapshots_skipped: outboxes.snapshots_skipped,
            snapshots_full: outboxes.snapshots_full,
            snapshots_delta: outboxes.snapshots_delta,
            snapshot_bytes_sent: outboxes.snapshot_bytes_sent,
            snapshot_refusals: self.snapshot_refusals,
            snapshot_refusals_logged: self.snapshot_refusals_logged,
            frame_refusals: self.frame_refusals,
            frame_refusals_logged: self.frame_refusals_logged,
            crashed: false,
        }
    }

    /// A call into the room panicked (see `guarded`): its connections are closed and `Closed` is reported (marked `crashed`),
    /// so the director frees every seat and gives the leases back instead of holding them until the process restarts.
    /// The simulation is not touched (its state is suspect: no results, no final hash). Never panics itself.
    fn crashed(&mut self) {
        eprintln!("[room] the room task panicked: reporting it closed");
        for h in &self.humans {
            if let Some(o) = &h.outbox {
                o.close(RejectCode::Kicked);
            }
        }
        let stats = RoomStats {
            crashed: true,
            ..self.stats()
        };
        let _ = self.reports.send(RoomReport::Closed {
            match_id: self.id,
            stats,
            final_hash: 0,
            replay: None,
        });
    }
}

/// Runs one call into the room for [`run_room`]. A panic inside it (a simulation assert, a bug) is caught, the room is
/// reported closed ([`Room::crashed`]) and `None` is returned: the task then ends. Only the room's own code is guarded,
/// so a task cancelled while its thread unwinds from someone else's panic reports nothing.
fn guarded<T>(room: &mut Room, f: impl FnOnce(&mut Room) -> T) -> Option<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(room))) {
        Ok(v) => Some(v),
        Err(_) => {
            room.crashed();
            None
        }
    }
}

/// The room's task: commands in arrival order between steps; one wake per grid slot.
///
/// C-TICK note: the select is `biased` with the step deadline first. When a step is due and commands are queued at the same
/// poll, the step runs first and the commands are applied (and acknowledged) after it, so they take effect in the next
/// step's input window. Before, either order was possible and a paused-clock run varied with the runtime's random branch
/// choice (about 1.4% in instructions). Only already-allowed orderings remain: a command arriving a moment after the wake
/// would have met the same order, and replays record the order actually applied. The deadline is one pinned [`Sleep`]
/// that is reset only when the grid's next slot changes, not a new timer per loop turn.
///
/// Overload: under sustained overload (a wake that takes longer than its slot), the next deadline is already past when the
/// select runs again, and the biased select alone would step forever without polling the inbox (joins, leaves and inputs
/// would starve until every client is closed `TooSlow`). So when a wake ends with its next step already due, the commands
/// already queued (at most [`INBOUND_CAP`], one inbox) are applied before that step: at most one wake runs between two
/// looks at the inbox. That is the same order a command arriving during the wake meets in the normal case (it is applied
/// after the step that was running, before the next one), so no new ordering is introduced; in the normal case (the next
/// deadline is still ahead) nothing changes and a due step still runs before a queued command.
///
/// A panic in the room is caught at the call (`guarded`) and reported as `Closed`, marked `crashed`.
///
/// [`Sleep`]: tokio::time::Sleep
pub async fn run_room(mut room: Room, mut rx: mpsc::Receiver<RoomCmd>) {
    let room = &mut room;
    let mut armed = room.next_deadline();
    let sleep = tokio::time::sleep_until(armed);
    tokio::pin!(sleep);
    loop {
        tokio::select! {
            biased;
            _ = &mut sleep => {
                if guarded(room, |r| r.wake(Instant::now())) != Some(true) { return; }
                // Overloaded (the next step is already due): what is queued now is applied before it.
                if room.next_deadline() <= Instant::now() {
                    for _ in 0..INBOUND_CAP {
                        match rx.try_recv() {
                            Ok(cmd) => {
                                if guarded(room, |r| r.handle(cmd, Instant::now())).is_none() || room.is_closed() { return; }
                            }
                            Err(mpsc::error::TryRecvError::Empty) => break,
                            Err(mpsc::error::TryRecvError::Disconnected) => {
                                guarded(room, Room::close);
                                return;
                            }
                        }
                    }
                }
                // The sleep has fired: arm it for the next slot (a wake that ran no step leaves the slot where it was,
                // and re-arming it then behaves as a fresh `sleep_until`, as before).
                armed = room.next_deadline();
                sleep.as_mut().reset(armed);
            }
            cmd = rx.recv() => match cmd {
                Some(cmd) => {
                    if guarded(room, |r| r.handle(cmd, Instant::now())).is_none() || room.is_closed() { return; }
                    let next = room.next_deadline();
                    if next != armed {
                        armed = next;
                        sleep.as_mut().reset(armed);
                    }
                }
                None => { guarded(room, Room::close); return; }
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(tick: Duration) -> RoomConfig {
        let assets = MapAssets::new(rh_sim::arenas::practice_arena()).unwrap();
        RoomConfig {
            sim: SimConfig {
                min_players: 2,
                lobby_seconds: 30.0,
                fill_seconds: 0.0,
                pvp_rules: true,
                weapon_specials: true,
                faction_mode: rh_sim::FactionMode::Off,
            },
            arena: assets.arena,
            welcome_map: assets.welcome_map,
            fill_bots_to: 0,
            tick,
            record: false,
            fixed_secrets: Some(Secrets::from_seed(7)),
            fixed_bot_seed: Some(7),
            reconnect_grace: RECONNECT_GRACE,
            linger: LINGER,
        }
    }

    #[test]
    fn live_fire_feed_matches_core() {
        let now = Instant::now();
        let tick = Duration::from_millis(50);
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut room = Room::new([9; 16], cfg(tick), tx, now);
        for (i, faction) in [FactionId::Fire, FactionId::Holy].into_iter().enumerate() {
            room.join(
                format!("p{i}"),
                Some(faction),
                Arc::new(Outbox::default()),
                i as u64 + 1,
                1,
                None,
            )
            .unwrap();
        }
        let placements = [FactionId::Fire, FactionId::Holy]
            .into_iter()
            .enumerate()
            .map(|(i, faction)| rh_sim::Placement {
                profile: format!("p{i}"),
                faction,
                bot: false,
                at: rh_sim::Vec2::new(400. + 56. * i as f64, 320.),
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect::<Vec<_>>();
        room.sim = Sim::reset_active(
            SimConfig {
                faction_mode: rh_sim::FactionMode::EngagementHolyPlagueFire,
                ..Default::default()
            },
            rh_sim::arenas::practice_arena(),
            Secrets::from_seed(7),
            &placements,
        );
        for h in &mut room.humans {
            h.fx.rebind(&room.sim, h.player);
        }
        let mut reference = room.sim.clone();
        let mut projector = rh_sim::FxProjector::attach(&reference, PlayerId(1));
        let mut signatures = 0;
        for n in 1..=40 {
            if n == 2 {
                for (id, a) in [(PlayerId(1), 0.), (PlayerId(2), std::f64::consts::PI)] {
                    let cmd = rh_sim::validate(rh_sim::RawCommand::Attack { a, t: None }).unwrap();
                    room.sim.submit(id, cmd).unwrap();
                    reference.submit(id, cmd).unwrap();
                }
            }
            reference.step();
            projector.feed(reference.fx_report()).unwrap();
            assert!(room.wake(now + tick * n));
            assert_eq!(room.sim.state_hash(), reference.state_hash());
            assert_eq!(room.humans[0].fx.events(), projector.events());
            signatures += projector
                .events()
                .iter()
                .filter(|e| matches!(e, SeenEvent::SignatureHit { .. }))
                .count();
        }
        assert!(signatures > 2);
        assert_eq!(room.frame_refusals, 0);
    }

    #[tokio::test(start_paused = true)]
    async fn a_renewal_that_observes_the_result_release_preserves_reliable_resume() {
        let start = Instant::now();
        let tick = Duration::from_millis(50);
        let (reports, mut rx) = mpsc::unbounded_channel();
        let mut room = Room::new([7; 16], cfg(tick), reports, start);
        let (validity, deadline) = tokio::sync::watch::channel(start + Duration::from_secs(120));
        let (reply, joined) = oneshot::channel();
        room.handle(
            RoomCmd::JoinLeased {
                admission: Admission {
                    gen: 1,
                    profile_id: None,
                },
                profile: "Winner".into(),
                faction: None,
                outbox: Arc::new(Outbox::default()),
                conn: 1,
                fence: 4,
                deadline,
                reply,
            },
            start,
        );
        let winner = joined.await.unwrap().unwrap();
        let other = room
            .join(
                "Other".into(),
                None,
                Arc::new(Outbox::default()),
                2,
                1,
                None,
            )
            .unwrap();
        assert!(room.wake(start + tick));
        assert_eq!(room.sim.phase(), Phase::Active);
        room.leave(other.player, GoneReason::Left);
        assert!(room.wake(start + tick * 2));
        assert!(std::iter::from_fn(|| rx.try_recv().ok()).any(
            |r| matches!(r, RoomReport::Result{fence:Some(4),profile,..} if profile=="Winner")
        ));
        // Durable record_result released this fence, but its director completion is still in
        // flight when renewal returns false. The room must still deliver the already earned result.
        validity.send_replace(start);
        let out = Arc::new(Outbox::default());
        let (reply, resumed) = oneshot::channel();
        room.handle(
            RoomCmd::Resume {
                session: winner.session,
                outbox: out.clone(),
                conn: 3,
                reply,
            },
            start + tick * 3,
        );
        assert_eq!(resumed.await.unwrap().unwrap().player, winner.player);
        let mut frames = Vec::new();
        let drained = out.drain_into(&mut frames);
        assert!(drained.close.is_none());
        assert!(frames.iter().any(|frame|matches!(rh_protocol::ServerMsg::decode(frame),
            Ok(rh_protocol::ServerMsg::Events{events,..}) if events.iter().any(|e|matches!(e,WireEvent::Result(_))))));
    }

    /// Under sustained overload (every wake takes 1.5 slots, so the next step is always already due when the loop looks
    /// again), queued commands are still applied after each wake. The biased step-first select alone never polled the
    /// inbox again: this join waited forever.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_overloaded_room_still_applies_queued_commands() {
        let tick = Duration::from_millis(20);
        let (reports, _keep) = mpsc::unbounded_channel();
        let metrics: &'static Metrics = Box::leak(Box::new(Metrics::new()));
        let mut room = Room::new([3; 16], cfg(tick), reports, Instant::now()).with_metrics(metrics);
        room.stall = tick * 3 / 2;
        let (tx, rx) = mpsc::channel(8);
        // Keeps the timer driver turning on the other worker while the room's worker is busy, so the room's re-armed
        // deadline is already elapsed for the timer wheel when the loop looks again (the starving case).
        let ticker = tokio::spawn(async {
            loop {
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        });
        let task = tokio::spawn(run_room(room, rx));
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        let result = async {
            while metrics.wakes.load(Ordering::Relaxed) < 3 {
                if tokio::time::Instant::now() >= deadline {
                    return Err("room did not reach overload: fewer than 3 wakes before deadline");
                }
                tokio::time::sleep(Duration::from_millis(1)).await;
            }

            let (reply, got) = oneshot::channel();
            tx.send(RoomCmd::Join {
                profile: "alpha".into(),
                faction: None,
                outbox: Arc::new(Outbox::default()),
                conn: 1,
                fence: 1,
                reply,
            })
            .await
            .map_err(|_| "room command channel closed before the join was queued")?;
            let ok = tokio::time::timeout_at(deadline, got)
                .await
                .map_err(|_| "the join was not applied while the room was overloaded")?
                .map_err(|_| "room dropped the join reply")?
                .map_err(|_| "join was not seated")?;
            drop(ok);
            Ok::<(), &str>(())
        }
        .await;
        task.abort();
        ticker.abort();
        result.expect("overloaded room test condition");
    }
}
