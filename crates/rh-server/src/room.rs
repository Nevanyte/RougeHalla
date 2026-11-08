//! One match: a task that owns its [`Sim`], its seats and its pacer. Everything that touches the simulation happens on this
//! task, in arrival order, between steps (the legacy rule: handlers validate and enqueue, the sim consumes at the next step).
//! Nothing here blocks on I/O: frames go to per-connection [`Outbox`]es, results to a channel drained off-tick.

use crate::bot_fill::{BotFillConfig, BotFillState, BotSeatSpec, FillView};
use crate::metrics::{self, Histogram, Metrics};
use crate::outbox::{Outbox, OutboxCounters};
use crate::pacer::Pacer;
use crate::wire;
use rh_policy::bots::delay::DelayLine;
use rh_policy::bots::random::Rng;
use rh_policy::bots::HumanBot;
use rh_policy::{drive_seats_queued, scripted, MatchStart, Policy, Seat};
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
        /// A bot's fill spec when it is a managed fill bot (the learning record caller's tier/persona/faction); None
        /// for a human or an unmanaged bot.
        bot_spec: Option<BotSeatSpec>,
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
    items: rh_sim::ItemObserver,
    collections: crate::wire_state::CollectionPublisher,
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
    /// The fill policy's spec per seated bot (tier/persona/faction), for the P-BOTS-5 record caller.
    bot_specs: Vec<(PlayerId, BotSeatSpec)>,
    fill_to: usize,
    /// The scheduled fill policy (legacy BotManager). None keeps the immediate placeholder fill.
    fill: Option<BotFillState>,
    /// The sim's lobby knobs the fill's closing step needs (the sim owns the countdown itself).
    min_players: usize,
    fill_seconds: f64,
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
    /// The fill bots' source delay lines (P-BOTS-7): one per seated fill bot, seeded from the manager's line stream.
    bot_lines: Vec<(PlayerId, DelayLine<rh_sim::PublicCommand>)>,
    line_rng: Rng,
    /// The read-only profile callsign set (source isNameTaken): a fill bot never draws one. Lower-cased.
    taken_names: Arc<std::collections::HashSet<String>>,
    /// Delay-line delivery counters. The source manager counts a command as refused only at DELIVERY time, when the
    /// delivered message is refused by the intake (enqueueClientMessage false); its MAX_QUEUED / unsupported-type
    /// rejections in deliver are not part of that refused (deliver returns false before sent++). The port keeps those
    /// separate in bot_line_dropped, so refused here is the source's delivery-time intake refusal and the counters are
    /// deliberately not parity-identical to the source's stats as a whole. lost also covers a seat that left between
    /// queuing and delivery, which the source never observes (it reads the runtime at delivery).
    bot_sent: u64,
    bot_applied: u64,
    bot_refused: u64,
    bot_line_dropped: u64,
    bot_lost: u64,
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
        wire::profile_supported(&cfg.sim).expect("refusing to host unsupported simulation profile");
        // Match secrets come from the OS CSPRNG and never leave this task (docs/CONTRACTS.md C-RNG).
        let secrets = cfg.fixed_secrets.unwrap_or_else(|| Secrets {
            order_salt: random_u32(),
            spawn_seed: random_u32(),
            reward_salt: std::array::from_fn(|_| random_u32()),
        });
        let sim = Sim::new(cfg.sim.clone(), cfg.arena, secrets);
        let min_players = cfg.sim.min_players;
        let fill_seconds = cfg.sim.fill_seconds;
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
            bot_specs: Vec::new(),
            fill_to: cfg.fill_bots_to,
            fill: None,
            min_players,
            fill_seconds,
            pacer: Pacer::new(now, cfg.tick),
            last_events: Vec::new(),
            step_events: Vec::new(),
            wake_events: Vec::new(),
            publisher: wire::Publisher::default(),
            bot_sight: rh_sim::SightCache::new(),
            bot_lines: Vec::new(),
            line_rng: Rng::new(0),
            taken_names: Arc::new(std::collections::HashSet::new()),
            bot_sent: 0,
            bot_applied: 0,
            bot_refused: 0,
            bot_line_dropped: 0,
            bot_lost: 0,
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
                        h.items.reconnect();
                        h.collections.reconnect();
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
                if let Some(index) = self
                    .humans
                    .iter()
                    .position(|h| h.player == player && h.conn == conn)
                {
                    self.humans[index].ack_input = seq;
                    for c in commands {
                        // Resolve only within this seat's delivered offer, then use the shared
                        // validator/budget/submit path. Target is an observer-issued reference,
                        // never a private-ID fallback. Misses are recorded ordinary commands.
                        let resolved = self.humans[index]
                            .items
                            .resolve(&self.sim, wire::command(c));
                        if let Ok(cmd) = resolved {
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
            self.yield_newest_bot();
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
            items: rh_sim::ItemObserver::new(player),
            collections: Default::default(),
            spare: None,
            result: None,
        });
        if self.fill.is_none() {
            self.fill_bots();
        }
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

    /// Opt into the legacy manager's lobby fill (BotManager.ts): bots arrive on a seeded schedule through the countdown,
    /// the closing step seats whoever has not arrived, and a joining human takes the newest bot's seat. Without it the room
    /// keeps its immediate placeholder fill above (the default for tests, benches and rooms that do not configure bots).
    ///
    /// The policy's seed comes from the room's fixed bot seed when set (tests, replay determinism), else OS entropy: the
    /// fill seed is not a match secret (docs/CONTRACTS.md C-RNG does not cover bot identity).
    pub fn with_bot_fill(mut self, cfg: BotFillConfig) -> Self {
        // Source BOTS_SEED seeds every manager stream; the rooms' fixed bot seed (tests, replays) wins over it.
        let seed = self
            .fixed_bot_seed
            .or_else(|| cfg.seed.map(u64::from))
            .unwrap_or_else(|| (u64::from(random_u32()) << 32) | u64::from(random_u32()));
        self.line_rng = DelayLine::<rh_sim::PublicCommand>::rng(seed as u32);
        self.fill = Some(BotFillState::new(cfg, seed));
        self
    }

    /// The manager's read-only profile-name seam (source isNameTaken): callsigns real profiles own, lower-cased. The set
    /// is a snapshot the director refreshes per lobby; bots never read or write a profile.
    pub fn with_bot_names(mut self, names: Arc<std::collections::HashSet<String>>) -> Self {
        self.taken_names = names;
        self
    }

    /// The delay line's send half (source BotManager.deliver): a fill bot's proposal gets its arrival from the manager's
    /// line stream; a seat with no fill spec (the immediate placeholder fill) submits now, as before.
    fn enqueue_bot_commands(&mut self, proposed: Vec<(PlayerId, rh_sim::PublicCommand)>) {
        if proposed.is_empty() {
            return;
        }
        let (latency, jitter) = self.fill.as_ref().map_or((0., 0.), |fill| {
            (fill.config().latency_ms, fill.config().jitter_ms)
        });
        let at = self.sim.server_time();
        for (player, cmd) in proposed {
            if let Some(pos) = self.bot_lines.iter().position(|(p, _)| *p == player) {
                let accepted = self.bot_lines[pos]
                    .1
                    .enqueue(&mut self.line_rng, at, latency, jitter, cmd)
                    .is_some();
                if accepted {
                    self.bot_sent += 1;
                } else {
                    // The line is at its 256-command cap (source MAX_QUEUED): a delivery-stage rejection, not an intake
                    // refusal. Kept apart from bot_refused so the source's delivery-time accounting stays legible.
                    self.bot_line_dropped += 1;
                }
            } else {
                self.submit_bot_now(player, cmd);
            }
        }
    }

    /// The delay line's delivery half (source BotManager.beforeStep, called with the upcoming step's time): a command
    /// arrives, is resolved against the state at that step and goes through validate + submit, the intake a human's
    /// message takes.
    fn deliver_bot_commands(&mut self) {
        if self.bot_lines.is_empty() {
            return;
        }
        let step_t = self.sim.server_time() + rh_sim::constants::TICK_MS;
        let mut due: Vec<(PlayerId, rh_sim::PublicCommand)> = Vec::new();
        for (player, line) in &mut self.bot_lines {
            let mut out = Vec::new();
            line.pop_due(step_t, &mut out);
            due.extend(out.into_iter().map(|cmd| (*player, cmd)));
        }
        for (player, cmd) in due {
            if self.sim.player(player).is_none() {
                self.bot_lost += 1;
                continue;
            }
            self.submit_bot_now(player, cmd);
        }
    }

    fn submit_bot_now(&mut self, player: PlayerId, cmd: rh_sim::PublicCommand) {
        let Some(index) = self.bots.iter().position(|seat| seat.player() == player) else {
            self.bot_lost += 1;
            return;
        };
        let Some(command) = self.bots[index].resolve(&self.sim, cmd) else {
            self.bot_refused += 1;
            self.bots[index].note_delivery(false);
            return;
        };
        if let Some(r) = self.recorder.as_mut() {
            r.record(ReplayInput::Command {
                player,
                cmd: command,
            });
        }
        match self.sim.submit(player, command) {
            Ok(()) => {
                self.bot_applied += 1;
                self.bots[index].note_delivery(true);
            }
            Err(_) => {
                self.bot_refused += 1;
                self.bots[index].note_delivery(false);
            }
        }
    }

    /// The delay-line counters (source manager stats' delivery half: sent, applied, refused, lost), for telemetry.
    /// refused is delivery-time intake refusal only (see the field docs); line-cap drops are reported by
    /// bot_line_dropped and are not part of these four.
    pub fn bot_delivery(&self) -> (u64, u64, u64, u64) {
        (
            self.bot_sent,
            self.bot_applied,
            self.bot_refused,
            self.bot_lost,
        )
    }

    /// Commands the delay line dropped because it already held its 256-command cap (source MAX_QUEUED). The source reports
    /// no such counter at all; it is kept here so the delivery-time refused count stays the source's meaning.
    pub fn bot_line_dropped(&self) -> u64 {
        self.bot_line_dropped
    }

    /// The seated fill bots' telemetry tags (id, callsign, tier, persona, faction, seed). The lobby HUD's head count and
    /// its presentation stay with the client/coordinator; this is the native per-bot telemetry surface.
    pub fn bot_specs(&self) -> &[(PlayerId, BotSeatSpec)] {
        &self.bot_specs
    }

    /// One lobby step of the fill policy, before the step it applies to (the manager's lobbyTick and, on the closing
    /// step, lobbyClosing): draws the arrivals that are due and seats them, then seats whoever is still missing when the
    /// lobby is about to close into the raid.
    fn fill_step(&mut self) {
        if self.fill.is_none() || self.sim.phase() != Phase::Lobby {
            return;
        }
        let now = self.sim.server_time();
        let ends = self.sim.lobby_ends_at();
        let mut factions = [0u32; 5];
        let mut names_lower = Vec::with_capacity(self.sim.players().len());
        let mut humans = 0usize;
        for player in self.sim.players() {
            names_lower.push(player.seat.name.to_lowercase());
            if !player.seat.bot {
                humans += 1;
            }
            let faction = player.core.vitals.faction;
            if let Some(index) = FactionId::ALL.iter().position(|known| *known == faction) {
                factions[index] += 1;
            }
        }
        let players = self.sim.players().len();
        let taken_names = self.taken_names.clone();
        let taken = |name: &str| taken_names.contains(&name.to_ascii_lowercase());
        let view = FillView {
            players,
            humans,
            factions,
            names_lower,
            taken: &taken,
        };
        // The step closes the lobby when the countdown is out, when the lobby is full, or when enough humans are in and
        // the fill time is zero (the sim's updateLobby rule). The manager seats its remaining arrivals on that step.
        let closing = humans >= rh_sim::constants::MAX_PLAYERS
            || now >= ends
            || (humans >= self.min_players && self.fill_seconds <= 0.);
        let mut specs: Vec<BotSeatSpec> = self
            .fill
            .as_mut()
            .map(|fill| fill.lobby_tick(now, ends, &view))
            .unwrap_or_default();
        if closing {
            if let Some(fill) = self.fill.as_mut() {
                specs.extend(fill.lobby_closing(&view));
            }
        }
        for spec in specs {
            self.seat_fill_bot(spec);
        }
    }

    /// Seats one bot the fill policy drew: its callsign, faction, tier and persona go on the normal seat contract, so it
    /// perceives only through observations and acts only through validate + submit; it never touches a profile or quest.
    fn seat_fill_bot(&mut self, spec: BotSeatSpec) {
        let name = spec.name.clone();
        let Some(id) = self.sim.add_player(&name, Some(spec.faction), true) else {
            return;
        };
        let policy: Box<dyn Policy> = Box::new(HumanBot::new(spec.tier, spec.persona));
        let interval = policy.spec().decision_interval_ticks;
        self.record(ReplayInput::Join {
            profile: name,
            faction: Some(spec.faction),
            bot: true,
            policy: Some(BotPolicy {
                name: "human".into(),
                interval,
                seed: u64::from(spec.seed),
            }),
        });
        let mut seat = Seat::new(
            &MatchStart::of(&self.sim, id, u64::from(spec.seed)),
            policy,
            Box::new(scripted::Idle),
        );
        seat.bind_fx(&self.sim).expect("new bot is unbound");
        self.bots.push(seat);
        self.bot_specs.push((id, spec));
        self.bot_lines.push((id, DelayLine::new()));
    }

    /// The newest bot gives its seat up (legacy BotManager.yieldSeat): the fill policy forgets it and the player leaves.
    fn yield_newest_bot(&mut self) -> bool {
        let Some((id, name)) = self
            .sim
            .players()
            .iter()
            .rev()
            .find(|player| player.seat.bot)
            .map(|player| (player.id, player.seat.name.clone()))
        else {
            return false;
        };
        if let Some(fill) = self.fill.as_mut() {
            if let Some(spec) = fill.yield_seat() {
                debug_assert_eq!(spec.name, name, "the fill policy seeded the newest bot");
            }
        }
        self.record(ReplayInput::Leave { player: id });
        self.sim.remove_player(id);
        self.bots.retain(|seat| seat.player() != id);
        self.bot_specs.retain(|(player, _)| *player != id);
        self.bot_lines.retain(|(player, _)| *player != id);
        true
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
            self.fill_step();
            let t = std::time::Instant::now();
            let mut proposed: Vec<(PlayerId, rh_sim::PublicCommand)> = Vec::new();
            drive_seats_queued(
                &mut self.sim,
                &mut self.bots,
                &self.last_events,
                &mut self.bot_sight,
                |player, cmd| proposed.push((player, cmd)),
            );
            self.enqueue_bot_commands(proposed);
            self.deliver_bot_commands();
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
        let (mut bytes_total, mut pushes) = (0u64, 0u64);
        for h in &mut self.humans {
            let Some(out) = &h.outbox else {
                h.carry.clear();
                continue;
            };
            let (frames, offer) = match self.publisher.frames_prepared(
                &mut h.items,
                h.spare.take(),
                &self.sim,
                h.ack_input,
                &[],
                &mut h.carry,
                events,
            ) {
                Ok(prepared) => prepared,
                Err(error) => {
                    if self.frame_refusals == 0 {
                        self.frame_refusals_logged += 1;
                        eprintln!("[room] unsupported observation: {error:?}");
                    }
                    self.frame_refusals += 1;
                    out.close(RejectCode::Malformed);
                    continue;
                }
            };
            if let Some(error) = frames.refused {
                if self.frame_refusals == 0 {
                    self.frame_refusals_logged += 1;
                    eprintln!("[room] frame not sent: {error}");
                }
                self.frame_refusals += 1;
            }
            let snap = match frames.snapshot {
                Ok(snap) => snap,
                Err(error) => {
                    if self.snapshot_refusals == 0 {
                        self.snapshot_refusals_logged += 1;
                        eprintln!("[room] snapshot not sent: {error}");
                    }
                    self.snapshot_refusals += 1;
                    out.close(RejectCode::Malformed);
                    continue;
                }
            };
            let mut state = match h.collections.prepare(
                self.publisher.observation(),
                offer.props_changed(),
                offer.rewards_changed(),
                out.state_resync_requested(),
            ) {
                Ok(pending) => pending,
                Err(error) => {
                    if self.frame_refusals == 0 {
                        self.frame_refusals_logged += 1;
                        eprintln!("[room] reliable state not sent: {error}");
                    }
                    self.frame_refusals += 1;
                    out.close(RejectCode::Malformed);
                    continue;
                }
            };
            let bytes = [&state.frame, &frames.important, &frames.fx]
                .into_iter()
                .flatten()
                .map(Vec::len)
                .sum::<usize>()
                + snap.min_len();
            let (spare, accepted) = out.push_tick_with_state(
                state.frame.take(),
                frames.important,
                frames.fx,
                Some(snap),
            );
            h.spare = spare;
            if accepted {
                let forced = state.commit(&mut h.collections);
                offer.commit();
                if forced {
                    out.state_resync_answered();
                }
                self.bytes_out += bytes as u64;
                bytes_total += bytes as u64;
                pushes += 1;
            }
            // Failed reliable enqueue drops both prepared guards: no handles or baseline advance.
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
                let bot_spec = if *bot {
                    self.bot_specs
                        .iter()
                        .find(|(player, _)| player == id)
                        .map(|(_, spec)| spec.clone())
                } else {
                    None
                };
                let _ = self.reports.send(RoomReport::Result {
                    admission,
                    match_id: self.id,
                    profile: result.profile.clone(),
                    bot: *bot,
                    bot_spec,
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

    #[test]
    #[should_panic(expected = "Source arena lifecycle requires protocol 7")]
    fn arena_profile_direct_room_construction_refuses_before_sim_or_entropy() {
        let mut config = cfg(Duration::from_millis(50));
        config.sim.lifecycle = rh_sim::ArenaMode::Source(Default::default());
        config.fixed_secrets = None;
        let (tx, _) = mpsc::unbounded_channel();
        Room::new([0; 16], config, tx, Instant::now());
    }

    #[test]
    #[should_panic(expected = "Full Wish casting requires protocol 7")]
    fn wish_profile_direct_room_construction_refuses_before_sim_or_entropy() {
        let mut config = cfg(Duration::from_millis(50));
        config.sim.abilities = rh_sim::abilities::Mode::Full;
        config.sim.lifecycle = rh_sim::ArenaMode::Off;
        config.fixed_secrets = None;
        let (tx, _) = mpsc::unbounded_channel();
        Room::new([0; 16], config, tx, Instant::now());
    }

    fn cfg(tick: Duration) -> RoomConfig {
        let assets = MapAssets::new(rh_sim::arenas::practice_arena()).unwrap();
        RoomConfig {
            sim: SimConfig {
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

    #[tokio::test(start_paused = true)]
    async fn live_pickup_resolves_delivered_handles_and_resume_replaces_the_offer() {
        use rh_protocol::{PickupHandle, ServerMsg, StateItem, WireCommand, WirePropKind};
        use rh_sim::{ContainerKind, Placement, Vec2, WeaponId};
        fn drain(out: &Outbox) -> Vec<ServerMsg> {
            let mut frames = Vec::new();
            assert_eq!(out.drain_into(&mut frames).close, None);
            frames
                .iter()
                .map(|f| ServerMsg::decode(f).unwrap())
                .collect()
        }
        fn props(messages: &[ServerMsg]) -> rh_protocol::WireProps {
            messages
                .iter()
                .filter_map(|m| match m {
                    ServerMsg::State { items, .. } => Some(items),
                    _ => None,
                })
                .flatten()
                .find_map(|s| match s {
                    StateItem::Props(p) => Some(p.clone()),
                    _ => None,
                })
                .unwrap()
        }
        let start = Instant::now();
        let tick = Duration::from_millis(50);
        let (reports, _rx) = mpsc::unbounded_channel();
        let mut room = Room::new([8; 16], cfg(tick), reports, start);
        let out = Arc::new(Outbox::default());
        let joined = room
            .join("viewer".into(), None, out.clone(), 1, 1, None)
            .unwrap();
        room.join(
            "other".into(),
            None,
            Arc::new(Outbox::default()),
            2,
            1,
            None,
        )
        .unwrap();
        room.sim = Sim::reset_active(
            SimConfig::default(),
            rh_sim::arenas::practice_arena(),
            Secrets::from_seed(7),
            &[
                Placement {
                    profile: "viewer".into(),
                    faction: FactionId::Holy,
                    bot: false,
                    at: Vec2::new(100., 272.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                },
                Placement {
                    profile: "other".into(),
                    faction: FactionId::Fire,
                    bot: false,
                    at: Vec2::new(1400., 272.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                },
            ],
        );
        room.sim
            .seed_weapon_container(
                ContainerKind::Ground,
                Vec2::new(1300., 272.),
                &[WeaponId::Bow],
            )
            .unwrap();
        let sword_id = room
            .sim
            .seed_weapon_container(
                ContainerKind::Ground,
                Vec2::new(100., 272.),
                &[WeaponId::Sword],
            )
            .unwrap();
        room.sim
            .seed_weapon_container(
                ContainerKind::Ground,
                Vec2::new(116., 272.),
                &[WeaponId::Axe],
            )
            .unwrap();
        for h in &mut room.humans {
            h.fx.rebind(&room.sim, h.player);
            h.items = rh_sim::ItemObserver::new(h.player);
        }
        room.publish(&[]);
        let initial = drain(&out);
        let first = props(&initial);
        let sword = first
            .rows
            .iter()
            .find(|r| r.kind == WirePropKind::Ground(0))
            .unwrap()
            .handle;
        assert_ne!(
            sword.get(),
            sword_id,
            "wire input carries an observer reference"
        );
        room.handle(
            RoomCmd::Input {
                player: joined.player,
                conn: 1,
                seq: 1,
                commands: vec![WireCommand::Pickup { handle: sword }],
            },
            start,
        );
        assert!(room.wake(start + tick));
        let picked = drain(&out);
        assert!(picked.iter().any(|m| matches!(m, ServerMsg::State {items,..} if items.iter().any(|i| matches!(i,StateItem::Inventory(Some(v)) if v.slots.contains(&Some(0)))))));
        assert!(!props(&picked)
            .rows
            .iter()
            .any(|r| r.kind == WirePropKind::Ground(0)));
        room.handle(
            RoomCmd::Input {
                player: joined.player,
                conn: 1,
                seq: 2,
                commands: vec![WireCommand::Pickup { handle: sword }],
            },
            start + tick,
        );
        assert!(room.wake(start + tick * 2));
        assert!(drain(&out).iter().any(|m| matches!(m, ServerMsg::Events {events,..} if events.iter().any(|e| matches!(e,rh_protocol::WireEvent::PickupRefused {reason:2})))));

        let fresh = Arc::new(Outbox::default());
        let (reply, resumed) = oneshot::channel();
        room.handle(
            RoomCmd::Resume {
                session: joined.session,
                outbox: fresh.clone(),
                conn: 3,
                reply,
            },
            start + tick * 2,
        );
        assert_eq!(resumed.await.unwrap().unwrap().player, joined.player);
        room.publish(&[]);
        let resumed_props = props(&drain(&fresh));
        assert!(resumed_props
            .rows
            .iter()
            .all(|r| !first.rows.iter().any(|old| old.handle == r.handle)));
        let axe = resumed_props
            .rows
            .iter()
            .find(|r| r.kind == WirePropKind::Ground(4))
            .unwrap()
            .handle;
        room.handle(
            RoomCmd::Input {
                player: joined.player,
                conn: 1,
                seq: 999,
                commands: vec![WireCommand::Pickup { handle: axe }],
            },
            start + tick * 2,
        );
        assert_eq!(
            room.humans[0].ack_input, 2,
            "replaced connection cannot act on the fresh offer"
        );
        room.handle(
            RoomCmd::Input {
                player: joined.player,
                conn: 3,
                seq: 3,
                commands: vec![WireCommand::Pickup {
                    handle: PickupHandle::new(sword.get()).unwrap(),
                }],
            },
            start + tick * 2,
        );
        assert!(room.wake(start + tick * 3));
        assert!(drain(&fresh).iter().any(|m| matches!(m, ServerMsg::Events {events,..} if events.iter().any(|e| matches!(e,rh_protocol::WireEvent::PickupRefused {reason:2})))));
        assert_eq!(room.frame_refusals, 0);
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

    /// The fill policy seats bots over the countdown (arrival schedule), tops the lobby up on the closing step and is a
    /// pure function of its seed: the same room config replays the same seats.
    #[test]
    fn the_fill_policy_schedules_arrivals_over_the_countdown() {
        let now = Instant::now();
        let tick = Duration::from_millis(50);
        let run = || {
            let (tx, _rx) = mpsc::unbounded_channel();
            let mut config = cfg(tick);
            config.fill_bots_to = 0;
            config.fixed_bot_seed = Some(7);
            let mut room = Room::new([12; 16], config, tx, now).with_bot_fill(BotFillConfig {
                fill_to: 4,
                arrival_seconds: 1.0,
                ..BotFillConfig::default()
            });
            room.join(
                "human1".into(),
                None,
                Arc::new(Outbox::default()),
                1,
                1,
                None,
            )
            .unwrap();
            let mut before = 0;
            let mut first_arrival = None;
            for i in 1..=609 {
                room.wake(now + tick * i);
                let bots = room.sim.players().iter().filter(|p| p.seat.bot).count();
                if i == 580 {
                    before = bots;
                }
                if bots > 0 && first_arrival.is_none() {
                    first_arrival = Some(i);
                }
            }
            let fill = room.fill.as_ref().expect("the fill policy is on");
            let lines: Vec<String> = fill.specs().iter().map(|spec| spec.line()).collect();
            let players: Vec<(String, FactionId, bool)> = room
                .sim
                .players()
                .iter()
                .map(|p| (p.seat.name.clone(), p.core.vitals.faction, p.seat.bot))
                .collect();
            (before, first_arrival, lines, players, room.sim.phase())
        };
        let (before, first, lines, players, phase) = run();
        assert_eq!(before, 0, "no bot arrives before the arrival window");
        let first = first.expect("bots arrive");
        assert!(
            first > 560,
            "the first arrival is inside the last seconds, at tick {first}"
        );
        assert_eq!(lines.len(), 3, "the lobby is topped up to four players");
        assert_eq!(phase, Phase::Active, "the countdown closes into the raid");
        assert_eq!(players.len(), 4);
        assert_eq!(players.iter().filter(|(_, _, bot)| *bot).count(), 3);
        let names: Vec<&str> = lines
            .iter()
            .map(|line| line.split(' ').nth(1).expect("a rendered name"))
            .collect();
        assert_eq!(
            names.iter().collect::<std::collections::HashSet<_>>().len(),
            3,
            "callsigns are unique in the room"
        );
        for name in &names {
            assert!(
                crate::bot_fill::CALLSIGN_POOL.contains(name)
                    || crate::bot_fill::CALLSIGN_POOL
                        .iter()
                        .any(|pool| name.starts_with(pool) && name.len() == pool.len() + 2),
                "the name is a callsign: {name}"
            );
        }
        // Every bot's sim seat carries the drawn faction, and the seat acts as a normal bot seat.
        for (name, faction, bot) in &players {
            if *bot {
                assert!(
                    FactionId::ALL.contains(faction),
                    "{name} has a known faction"
                );
            }
        }
        // Determinism: the same fixed bot seed and plan draw the same seats.
        let (_, _, again, _, _) = run();
        assert_eq!(lines, again, "the fill policy replays from its seed");
    }

    #[test]
    fn a_human_joining_a_full_lobby_takes_the_newest_bot_seat() {
        let now = Instant::now();
        let tick = Duration::from_millis(50);
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut config = cfg(tick);
        config.fill_bots_to = 0;
        config.fixed_bot_seed = Some(5);
        let mut room = Room::new([13; 16], config, tx, now).with_bot_fill(BotFillConfig {
            fill_to: 8,
            arrival_seconds: 0.2,
            ..BotFillConfig::default()
        });
        room.join(
            "human1".into(),
            None,
            Arc::new(Outbox::default()),
            1,
            1,
            None,
        )
        .unwrap();
        for i in 1..=600 {
            room.wake(now + tick * i);
            if room.sim.players().len() >= 8 {
                break;
            }
        }
        assert_eq!(room.sim.players().len(), 8, "the fill seats seven bots");
        assert_eq!(
            room.sim.phase(),
            Phase::Lobby,
            "the join happens in the lobby"
        );
        let specs_before = room.fill.as_ref().unwrap().specs().len();
        let bots_before = room.sim.players().iter().filter(|p| p.seat.bot).count();
        room.join(
            "human2".into(),
            None,
            Arc::new(Outbox::default()),
            2,
            2,
            None,
        )
        .unwrap();
        assert_eq!(room.sim.players().len(), 8, "the human takes the seat");
        assert_eq!(
            room.sim.players().iter().filter(|p| p.seat.bot).count(),
            bots_before - 1
        );
        assert_eq!(room.sim.players().iter().filter(|p| !p.seat.bot).count(), 2);
        let fill = room.fill.as_ref().unwrap();
        assert_eq!(fill.stats().yielded, 1);
        assert_eq!(fill.specs().len(), specs_before - 1);
        assert_eq!(fill.stats().arrived, 7);
    }

    /// P-BOTS-5 remainder: a resolved fill bot's report carries the spec the record caller needs (tier/persona/faction),
    /// so the director can build the learning summary without guessing from the wire result.
    #[test]
    fn a_bot_result_report_carries_its_fill_spec() {
        use rh_policy::bots::{PersonaId, TierId};
        let (reports, mut rx) = mpsc::unbounded_channel();
        let mut room = Room::new(
            [7; 16],
            cfg(Duration::from_millis(50)),
            reports,
            Instant::now(),
        );
        let spec = BotSeatSpec {
            number: 1,
            name: "Wren".into(),
            tier: TierId::Hard,
            persona: PersonaId::Hunter,
            faction: FactionId::Plague,
            seed: 5,
        };
        let bot = PlayerId(1);
        room.bot_specs.push((bot, spec.clone()));
        let result = rh_sim::RunResult {
            outcome: rh_sim::Outcome::Died,
            profile: "Wren".into(),
            faction: Some(FactionId::Plague),
            weapon: None,
            duration_sec: 3,
            kills: 1,
            killed_by: None,
            killed_by_bot: false,
            place: 2,
            players: 2,
            gv: Default::default(),
            win_bonus_withheld: false,
            win_bonus_why: None,
        };
        room.report_results(&[Event::Resolved {
            id: bot,
            result: result.clone(),
            bot: true,
        }]);
        match rx.try_recv().expect("a bot result report") {
            RoomReport::Result {
                bot: true,
                bot_spec: Some(got),
                result: reported,
                ..
            } => {
                assert_eq!(got, spec);
                assert_eq!(reported, result);
            }
            other => panic!("expected a bot result with its fill spec, got {other:?}"),
        }
    }

    /// P-BOTS-7 remainder: a fill room with a running raid, for the delay-line and name-seam tests.
    fn running_fill_room(
        latency_ms: f64,
        seed: u32,
        taken: Arc<std::collections::HashSet<String>>,
    ) -> (Room, Instant) {
        let start = Instant::now();
        let tick = Duration::from_millis(50);
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut config = cfg(tick);
        config.fill_bots_to = 0;
        config.fixed_bot_seed = Some(u64::from(seed) + 100);
        config.fixed_secrets = Some(Secrets::from_seed(7));
        let mut room = Room::new([21; 16], config, tx, start)
            .with_bot_fill(BotFillConfig {
                fill_to: 4,
                arrival_seconds: 0.,
                latency_ms,
                jitter_ms: 0.,
                seed: Some(seed),
                ..BotFillConfig::default()
            })
            .with_bot_names(taken);
        for i in 0..2u64 {
            room.join(
                format!("human{i}"),
                None,
                Arc::new(Outbox::default()),
                i + 1,
                1,
                None,
            )
            .unwrap();
        }
        let mut last = start;
        for i in 1..=600u32 {
            last = start + tick * i;
            room.wake(last);
            if room.sim.phase() == Phase::Active {
                break;
            }
        }
        assert_eq!(
            room.sim.phase(),
            Phase::Active,
            "the lobby fills and closes"
        );
        assert!(!room.bot_specs.is_empty(), "the fill seated bots");
        (room, last)
    }

    #[test]
    fn a_fill_bots_command_arrives_after_the_configured_latency() {
        let (mut room, last) =
            running_fill_room(100., 9, Arc::new(std::collections::HashSet::new()));
        let tick = Duration::from_millis(50);
        // Find the first wake on which the seated bots propose: with a 100 ms one-way latency those proposals cannot be
        // applied by the same or the next 50 ms step (the source deliver/beforeStep rule).
        let mut first = None;
        for i in 1..=12u32 {
            room.wake(last + tick * i);
            let (sent, applied, _, _) = room.bot_delivery();
            if sent > 0 {
                first = Some((i, sent, applied));
                break;
            }
        }
        let (i, sent, applied) = first.expect("the seated bots propose commands");
        assert!(sent > 0);
        assert_eq!(
            applied, 0,
            "a 100 ms command cannot arrive within the first step"
        );
        // The arrival is due before the next step.
        room.wake(last + tick * (i + 1));
        let (_, applied, refused, lost) = room.bot_delivery();
        assert!(applied > 0, "the command arrives at the next step");
        assert!(refused <= sent);
        assert_eq!(lost, 0);
        // Determinism: the same fixed seed draws the same manager stream and the same counters.
        let (mut again, last_again) =
            running_fill_room(100., 9, Arc::new(std::collections::HashSet::new()));
        for k in 1..=i + 1 {
            again.wake(last_again + tick * k);
        }
        assert_eq!(
            room.bot_delivery(),
            again.bot_delivery(),
            "the delay line replays from its seed"
        );
    }

    #[test]
    fn a_fill_bot_never_draws_a_profile_owned_callsign() {
        let taken = crate::bot_fill::name_set(
            crate::bot_fill::CALLSIGN_POOL
                .iter()
                .map(|name| (*name).to_string()),
        );
        let (room, _last) = running_fill_room(30., 11, taken.clone());
        assert!(!room.bot_specs.is_empty());
        for (_, spec) in &room.bot_specs {
            assert!(
                !taken.contains(&spec.name.to_ascii_lowercase()),
                "drew a profile-owned callsign {}",
                spec.name
            );
        }
    }

    /// P-BOTS-7b repair: bot_refused is the source's DELIVERY-time intake refusal; a delay-line cap rejection (source
    /// MAX_QUEUED, which the source stats do not report at all) is the separate native bot_line_dropped counter.
    #[test]
    fn bot_refused_is_delivery_intake_only_and_line_drops_are_separate() {
        let (mut room, _last) =
            running_fill_room(0., 13, Arc::new(std::collections::HashSet::new()));
        assert!(
            !room.bot_lines.is_empty(),
            "the fill seated bots with delay lines"
        );
        let player = room.bot_lines[0].0;
        let (sent0, _applied0, refused0, _lost0) = room.bot_delivery();
        let dropped0 = room.bot_line_dropped();
        let cap = rh_policy::bots::delay::MAX_QUEUED;
        let batch: Vec<(PlayerId, rh_sim::PublicCommand)> = (0..cap + 5)
            .map(|_| (player, rh_sim::PublicCommand::Stop { seq: None }))
            .collect();
        room.enqueue_bot_commands(batch);
        let (sent, _applied, refused, _lost) = room.bot_delivery();
        let accepted = sent - sent0;
        let dropped = room.bot_line_dropped() - dropped0;
        assert_eq!(dropped, 5, "the overflow past MAX_QUEUED is a line drop");
        assert_eq!(
            accepted + dropped,
            cap as u64 + 5,
            "every proposal is either queued or dropped"
        );
        assert!(accepted <= cap as u64);
        assert_eq!(
            refused, refused0,
            "a line-cap drop is not a delivery refusal"
        );
        // A delivery-time refusal (a delivered proposal the resolver rejects) is exactly what the source counts. Actor 0
        // is the reserved "no actor" id: the resolver refuses the target instead of validating a missing-target command.
        room.submit_bot_now(player, rh_sim::PublicCommand::Target { actor: PlayerId(0) });
        let (_, _, refused, _) = room.bot_delivery();
        assert_eq!(
            refused,
            refused0 + 1,
            "an unresolvable delivered command is refused"
        );
        assert_eq!(
            room.bot_line_dropped() - dropped0,
            5,
            "intake refusal is not a line drop"
        );
    }
}
