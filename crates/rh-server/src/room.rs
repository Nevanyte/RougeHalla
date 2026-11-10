//! One match: a task that owns its [`Sim`], its seats and its pacer. Everything that touches the simulation happens on this
//! task, in arrival order, between steps (the legacy rule: handlers validate and enqueue, the sim consumes at the next step).
//! Nothing here blocks on I/O: frames go to per-connection [`Outbox`]es, results to a channel drained off-tick.

// The file the packet names as `src/rtt.rs`; declared here because `lib.rs` is outside this phase's write scope.
#[path = "rtt.rs"]
pub mod rtt;

use crate::bot_fill::{BotFillConfig, BotFillState, BotSeatSpec, FillView};
use crate::metrics::{self, Histogram, Metrics};
use crate::outbox::{Outbox, OutboxCounters};
use crate::pacer::Pacer;
use crate::wire;
use rh_policy::bots::delay::DelayLine;
use rh_policy::bots::random::Rng;
use rh_policy::bots::HumanBot;
use rh_policy::{drive_seats_queued, scripted, MatchStart, Policy, Seat};
use rh_protocol::map::EncodedMap;
use rh_protocol::{encode_welcome, RejectCode, ServerMsg, WelcomeHeader, WireEvent, WireResult};
use rh_sim::constants::TICK_MS;
use rh_sim::replay::{BotPolicy, Recorder, Replay, ReplayInput, ReplayStart};
use rh_sim::{
    Arena, Event, FactionId, Phase, PlayerId, RunResult, Secrets, SeenEvent, Sim, SimConfig,
};
use rtt::{clamp_render_time_noted, RewindClampStats, RttEstimator};
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
/// A training room whose seat accepted no input for this long closes itself (legacy trainingIdle: the practice client gave
/// up; the room has no run to settle and nothing to bank, so it just closes).
pub const TRAINING_IDLE_SECONDS: u64 = 300;

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
        /// When the connection task decoded the frame (telemetry only: input age at the step that applies it).
        received: std::time::Instant,
    },
    /// One server-measured RTT sample (a Pong matching a Ping this connection was sent), for the seat's rewind window.
    /// Samples from a connection that no longer owns the seat are ignored.
    RttSample {
        player: PlayerId,
        conn: u64,
        rtt_ms: f64,
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
    /// Server-measured RTT samples the room accepted over every seat it had, and the last and highest smoothed estimate
    /// (milliseconds) the estimator produced (P-NET-1 Phase 3, for P-OPS-2).
    ///
    /// `skip`: the `/info` closed-room key set is pinned by a director test and is outside this phase's write scope, so
    /// the JSON contract stays byte-for-byte the same; the counters live on the Rust `RoomStats` for P-OPS-2 to expose.
    #[serde(skip)]
    pub rtt_samples: u64,
    #[serde(skip)]
    pub rtt_last_ms: f64,
    #[serde(skip)]
    pub rtt_max_ms: f64,
    /// Attack/release render times the server bounded by its measured RTT, over every seat (P-OPS-2's cheat counter).
    #[serde(skip)]
    pub rewind_clamps: u64,
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
        let welcome_map = crate::public_ground::encode_static_map(&arena.map)?;
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
    /// When the oldest Input message not yet applied by a step was decoded on its connection (telemetry: input age).
    input_received: Option<std::time::Instant>,
    /// The server-measured RTT of this seat's current connection: it bounds the attack render times this seat may claim.
    rtt: RttEstimator,
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
    reported_bots: std::collections::BTreeSet<u32>,
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
    /// Server-measured RTT samples the room accepted, and the last and highest smoothed estimate any seat reported (for
    /// P-OPS-2 and diagnostics; the per-seat estimator is what the clamp reads).
    rtt_samples: u64,
    rtt_last_ms: f64,
    rtt_max_ms: f64,
    /// Attack/release render times the RTT bound rewrote (every clamp, for P-OPS-2).
    rewind_clamps: u64,
    /// Start of the last step run (stamped on each tick batch for the writer's step-to-write latency).
    last_step_start: Option<std::time::Instant>,
    /// A training room (a practice world: one human, no bots, no results or banking, an idle close and no replay).
    training: bool,
    /// When this room's seat last had a command accepted (the training idle clock); opened_at before the first one.
    last_input_at: Option<Instant>,
    /// The training idle limit (TRAINING_IDLE_SECONDS); tests shorten it.
    training_idle: Duration,
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
        assert!(
            crate::public_ground::matches_static_map(&cfg.welcome_map, &cfg.arena.map),
            "refusing a Welcome cache that differs from the room's canonical public map"
        );
        let training = cfg.sim.training;
        // Match secrets come from the OS CSPRNG and never leave this task (docs/CONTRACTS.md C-RNG).
        let secrets = cfg.fixed_secrets.unwrap_or_else(|| Secrets {
            order_salt: random_u32(),
            spawn_seed: random_u32(),
            reward_salt: std::array::from_fn(|_| random_u32()),
        });
        let sim = Sim::new(cfg.sim.clone(), cfg.arena, secrets);
        let min_players = cfg.sim.min_players;
        let fill_seconds = cfg.sim.fill_seconds;
        // A training room has no run, result or replay to record: it never creates a recorder (no banking/telemetry of a
        // result and no private replay), whatever the hosting configuration asked for.
        let recorder = (cfg.record && !training).then(|| {
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
            reported_bots: Default::default(),
            fill_to: if training { 0 } else { cfg.fill_bots_to },
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
            rtt_samples: 0,
            rtt_last_ms: 0.0,
            rtt_max_ms: 0.0,
            rewind_clamps: 0,
            last_step_start: None,
            training,
            last_input_at: None,
            training_idle: Duration::from_secs(TRAINING_IDLE_SECONDS),
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
            crate::public_ground::mode(self.sim.config().hazards),
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
                        // A new connection is a new path: its first Pong measures it, the old estimate is not inherited.
                        h.rtt = RttEstimator::new();
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
                received,
            } => {
                if let Some(index) = self
                    .humans
                    .iter()
                    .position(|h| h.player == player && h.conn == conn)
                {
                    self.humans[index].ack_input = seq;
                    self.humans[index].input_received.get_or_insert(received);
                    // The clamp is written for the sim time this batch will be applied at: the room applies commands
                    // between steps and the next step adds one tick first, so `note_lag` in the sim will see
                    // `now_apply` as its `now`. P-NET-1 Phase 3: bound an attack render time by the RTT the server
                    // measured for this connection (never by the client's claim), before `Sim::submit`. Cast render-time
                    // metadata receives the same bound, but Wish effects are not rewound by it.
                    let now_apply = self.sim.server_time() + TICK_MS;
                    let mut accepted = 0u32;
                    let mut clamps = RewindClampStats::default();
                    let mut refused = metrics::IntakeRefusals::default();
                    for c in commands {
                        let trigger = matches!(
                            c,
                            rh_protocol::WireCommand::Attack { .. }
                                | rh_protocol::WireCommand::Release { .. }
                        );
                        let (proposal, clamped) = clamp_render_time_noted(
                            wire::command(c),
                            now_apply,
                            &self.humans[index].rtt,
                            &mut clamps,
                        );
                        if clamped {
                            self.rewind_clamps += 1;
                        }
                        // Resolve only within this seat's delivered offer, then use the shared
                        // validator/budget/submit path. Target is an observer-issued reference,
                        // never a private-ID fallback. Misses are recorded ordinary commands.
                        let resolved = self.humans[index].items.resolve(&self.sim, proposal);
                        if let Ok(cmd) = resolved {
                            self.record(ReplayInput::Command { player, cmd });
                            match self.sim.submit(player, cmd) {
                                Ok(()) => accepted += 1,
                                Err(why) => refused.note(why, trigger),
                            }
                        }
                    }
                    self.metrics.note_rewind_clamps(&clamps);
                    self.metrics.note_intake_refusals(&refused);
                    // The training idle clock runs on ACCEPTED inputs (a rejected/no-op command does not keep the room up).
                    if accepted > 0 {
                        self.last_input_at = Some(now);
                    }
                }
            }
            RoomCmd::RttSample {
                player,
                conn,
                rtt_ms,
            } => {
                // Only the connection that owns the seat may move its window; a replaced connection's late Pongs are
                // ignored, so a resume starts measuring the new path from scratch.
                if let Some(h) = self
                    .humans
                    .iter_mut()
                    .find(|h| h.player == player && h.conn == conn)
                {
                    h.rtt.sample(rtt_ms);
                    let estimate = h.rtt.estimate_ms();
                    rtt::note_estimate(self.id, player, estimate);
                    self.rtt_samples += 1;
                    self.rtt_last_ms = estimate;
                    self.rtt_max_ms = self.rtt_max_ms.max(estimate);
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
        // A training room seats exactly one human (the practice console is a solo room; there is no second seat to fill).
        if self.training && !self.humans.is_empty() {
            return Err(RejectCode::MatchFull);
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
            input_received: None,
            rtt: RttEstimator::new(),
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

    pub fn with_learning(mut self, sink: Arc<dyn crate::bot_learning::LearningSink>) -> Self {
        if let Some(fill) = &mut self.fill {
            fill.set_learning_sink(sink);
        }
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
            let faction = player.faction();
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
        // A training room whose seat stopped sending accepted inputs closes: there is no run to settle and nothing to bank.
        if self.training {
            let since = self.last_input_at.unwrap_or(self.opened_at);
            if now.duration_since(since) >= self.training_idle {
                return self.close();
            }
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
            // Input age: every Input message the room took since the last step is applied by this one.
            for h in &mut self.humans {
                if let Some(at) = h.input_received.take() {
                    self.metrics.input_age_us.record(
                        t.saturating_duration_since(at)
                            .as_micros()
                            .min(u128::from(u32::MAX)) as u32,
                    );
                }
            }
            self.last_step_start = Some(t);
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
        // A training room never resolves a run: a between-tick down event is not a result let alone banked, and no result
        // frame is ever sent to its seat.
        let all_events = if self.training {
            let mut kept = all_events;
            kept.retain(|e| !matches!(e, Event::Resolved { .. }));
            kept
        } else {
            all_events
        };
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
            // A forced replacement renews all capability namespaces off to the side. Failed
            // encoding or enqueue preserves the live epoch; successful delivery installs both.
            let resync_requested = out.state_resync_requested();
            let mut renewal = h
                .collections
                .resync_due(self.sim.tick(), resync_requested)
                .then(|| h.items.renewed());
            let observer = match renewal.as_mut() {
                Some(observer) => observer,
                None => &mut h.items,
            };
            let (frames, offer) = match self.publisher.frames_prepared(
                observer,
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
                // A refused part of this tick cannot publish a new capability epoch or baseline.
                out.close(RejectCode::Malformed);
                continue;
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
                resync_requested,
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
            let (spare, accepted) = out.push_tick_stamped(
                self.last_step_start,
                state.frame.take(),
                frames.important,
                frames.fx,
                Some(snap),
            );
            h.spare = spare;
            if accepted {
                let forced = state.commit(&mut h.collections);
                offer.commit();
                if let Some(observer) = renewal {
                    h.items = observer;
                }
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
        if self.training {
            return;
        }
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
    fn report_results(&mut self, events: &[Event]) {
        // A training room never settles or banks a run: no result reaches the director (and so no durable match).
        if self.training {
            return;
        }
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
                if let Some(spec) = &bot_spec {
                    if !self.reported_bots.insert(spec.number) {
                        continue;
                    }
                }
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
            rtt_samples: self.rtt_samples,
            rtt_last_ms: self.rtt_last_ms,
            rtt_max_ms: self.rtt_max_ms,
            rewind_clamps: self.rewind_clamps,
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
#[path = "room/ground_tests.rs"]
mod public_ground_tests;

// Wire command in, terminal simulation outcome out, at the seat boundary (Wish landing/cancel, press/burst/release).
#[cfg(test)]
#[path = "room/seat_boundary_tests.rs"]
mod seat_boundary_tests;

// Private native bridge component tests; these do not admit a hosted quest profile.
#[cfg(test)]
#[path = "quest_bridge_tests.rs"]
mod quest_bridge_tests;

#[cfg(test)]
#[path = "trade_bridge_tests.rs"]
mod trade_bridge_tests;

#[cfg(test)]
mod tests {
    use super::*;

    mod trophy_fixture {
        include!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/support/trophy_fixture.rs"
        ));
    }

    /// Protocol 8 admits the source lifecycle transport; constructing a direct room must not panic and keeps the lobby
    /// phase until the first steps close it (the Wish profile remains refused).
    #[test]
    fn arena_profile_direct_room_construction_is_admitted_transport() {
        let mut config = cfg(Duration::from_millis(50));
        config.sim.lifecycle = rh_sim::ArenaMode::Source(Default::default());
        config.fixed_secrets = None;
        let (tx, _) = mpsc::unbounded_channel();
        let room = Room::new([0; 16], config, tx, Instant::now());
        assert_eq!(room.sim.phase(), Phase::Lobby);
    }

    /// The admitted rh-map/2 export the arena capture uses: spawn pool, coliseum and planning walks. The map is copied
    /// without modification (never generated here), exactly as the parity harness attaches it to its Arena.
    pub(super) fn source_arena() -> rh_sim::Arena {
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../parity/arena/source.json"
        ))
        .expect("parity/arena/source.json");
        let source: serde_json::Value = serde_json::from_str(&text).expect("arena capture json");
        let export: rh_sim::mapdata::MapExport =
            serde_json::from_value(source["map"]["export"].clone()).expect("rh-map/2 export");
        let (w, h, tiles, layers) = export.validate().expect("admitted map layers").into_parts();
        let spawns = layers
            .data()
            .spawns
            .iter()
            .map(|p| rh_sim::Vec2::new(p.x, p.y))
            .collect();
        rh_sim::Arena {
            map: rh_sim::TileMap::new(w, h, tiles)
                .expect("map tiles")
                .with_layers(layers)
                .expect("layers fit the tiles"),
            spawns,
        }
    }

    fn arena_room(
        lobby_seconds: f64,
        plan_seconds: f64,
    ) -> (Room, mpsc::UnboundedReceiver<RoomReport>) {
        let mut config = cfg(Duration::from_millis(50));
        let assets = MapAssets::new(source_arena()).unwrap();
        config.arena = assets.arena;
        config.welcome_map = assets.welcome_map;
        config.sim.lifecycle = rh_sim::ArenaMode::Source(rh_sim::ArenaRules {
            plan_seconds,
            ..Default::default()
        });
        config.sim.lobby_seconds = lobby_seconds;
        let (tx, rx) = mpsc::unbounded_channel();
        (Room::new([7; 16], config, tx, Instant::now()), rx)
    }

    pub(super) fn drain(out: &Outbox) -> Vec<ServerMsg> {
        let mut frames = Vec::new();
        assert_eq!(out.drain_into(&mut frames).close, None);
        frames
            .iter()
            .map(|f| ServerMsg::decode(f).unwrap())
            .collect()
    }

    /// The last complete-replacement Plan item across the frames (whether it carried a plan or cleared it).
    fn latest_plan_item(messages: &[ServerMsg]) -> Option<Option<rh_protocol::WirePlan>> {
        let mut found = None;
        for message in messages {
            let ServerMsg::State { items, .. } = message else {
                continue;
            };
            for item in items {
                if let rh_protocol::StateItem::Plan(plan) = item {
                    found = Some(plan.clone());
                }
            }
        }
        found
    }

    /// The e2e transport on the admitted source profile: the lobby closes into planning, each owner receives its own
    /// private deal as a complete-replacement State key (never another player's), picks and ready go through the ordinary
    /// input frame and the run starts; the plan key clears when planning ends. Admission closes at planning (C-NET).
    #[tokio::test(start_paused = true)]
    async fn source_planning_transport_delivers_each_owner_plan_and_starts_the_run() {
        use rh_protocol::{WireCommand, WirePlan};
        let (mut room, _reports) = arena_room(0.25, 1.0);
        let start = Instant::now();
        let tick = Duration::from_millis(50);
        let a_out = Arc::new(Outbox::default());
        let b_out = Arc::new(Outbox::default());
        let a = room
            .join("a".into(), None, a_out.clone(), 1, 1, None)
            .unwrap();
        let b = room
            .join("b".into(), None, b_out.clone(), 2, 2, None)
            .unwrap();
        let mut at = start;
        for _ in 0..10 {
            at += tick;
            assert!(room.wake(at));
            if room.sim.phase() == Phase::Planning {
                break;
            }
        }
        assert_eq!(
            room.sim.phase(),
            Phase::Planning,
            "the source lobby closes into planning"
        );
        let a_plan: WirePlan = latest_plan_item(&drain(&a_out))
            .expect("the owner plan key was sent")
            .expect("the owner has a deal");
        let b_plan: WirePlan = latest_plan_item(&drain(&b_out))
            .expect("the other owner plan key was sent")
            .expect("the other owner has a deal");
        // Both options are resolved server facts: a pool index, a quantized position, a zone and a walk time.
        assert!(a_plan.spawns.iter().all(|s| s.is_some()));
        assert!(a_plan.options.iter().all(|o| o.is_some()));
        assert!(a_plan.ends_at > 0.);
        assert_ne!(
            a_plan.spawns, b_plan.spawns,
            "the two deals are private and disjoint"
        );
        // Admission closes at planning start.
        let late = Arc::new(Outbox::default());
        assert_eq!(
            room.join("late".into(), None, late, 3, 3, None).err(),
            Some(RejectCode::MatchFull)
        );
        // Picking and readying are ordinary validate+submit input commands (C-INPUT).
        at += tick;
        room.handle(
            RoomCmd::Input {
                received: std::time::Instant::now(),
                player: a.player,
                conn: 1,
                seq: 1,
                commands: vec![WireCommand::Plan {
                    spawn: Some(0),
                    boon: None,
                    ready: None,
                }],
            },
            at,
        );
        let mut picked = None;
        for _ in 0..3 {
            at += tick;
            assert!(room.wake(at));
            if let Some(Some(plan)) = latest_plan_item(&drain(&a_out)) {
                if plan.pick.is_some() {
                    picked = Some(plan.pick);
                    break;
                }
            }
        }
        assert_eq!(picked, Some(Some(0)), "the owner's own pick is sent back");
        // Both seats ready: planning ends and the run starts.
        for (player, conn) in [(a.player, 1), (b.player, 2)] {
            at += tick;
            room.handle(
                RoomCmd::Input {
                    received: std::time::Instant::now(),
                    player,
                    conn,
                    seq: 2,
                    commands: vec![WireCommand::Plan {
                        spawn: None,
                        boon: None,
                        ready: Some(true),
                    }],
                },
                at,
            );
        }
        for _ in 0..3 {
            at += tick;
            assert!(room.wake(at));
            if room.sim.phase() == Phase::Active {
                break;
            }
        }
        assert_eq!(
            room.sim.phase(),
            Phase::Active,
            "every connected seat is ready"
        );
        let cleared = latest_plan_item(&drain(&a_out));
        assert!(
            matches!(cleared, Some(None)),
            "the private deal clears when planning ends"
        );
    }

    #[test]
    fn explicitly_configured_full_wish_room_construction_is_admitted() {
        let mut config = cfg(Duration::from_millis(50));
        config.sim.abilities = rh_sim::abilities::Mode::Full;
        config.sim.lifecycle = rh_sim::ArenaMode::Off;
        config.fixed_secrets = None;
        let (tx, _) = mpsc::unbounded_channel();
        let room = Room::new([0; 16], config, tx, Instant::now());
        assert_eq!(room.sim.config().abilities, rh_sim::abilities::Mode::Full);
    }

    pub(super) fn cfg(tick: Duration) -> RoomConfig {
        let assets = MapAssets::new(rh_sim::arenas::practice_arena()).unwrap();
        RoomConfig {
            sim: SimConfig {
                walk_hints: None,
                lag_fairness: false,
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
                // Off until the coordinator-owned quest transport packet lands; the lifecycle has its own config switch.
                quests: false,
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
                received: std::time::Instant::now(),
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
                received: std::time::Instant::now(),
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
                received: std::time::Instant::now(),
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
                received: std::time::Instant::now(),
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

    #[tokio::test(start_paused = true)]
    async fn failed_publish_holds_wish_barrier_owner_combat_and_new_pickup_handles() {
        use rh_protocol::{ServerMsg, StateItem, WirePropKind};
        use rh_sim::{ContainerKind, FactionId, Placement, Vec2, WeaponId};

        let start = Instant::now();
        let tick = Duration::from_millis(50);
        let (reports, _rx) = mpsc::unbounded_channel();
        let mut config = cfg(tick);
        config.sim.abilities = rh_sim::abilities::Mode::Full;
        let mut room = Room::new([12; 16], config, reports, start);
        let stale = Arc::new(Outbox::default());
        let joined = room
            .join(
                "owner".into(),
                Some(FactionId::Fire),
                stale.clone(),
                1,
                1,
                None,
            )
            .unwrap();
        room.join(
            "peer".into(),
            Some(FactionId::Holy),
            Arc::new(Outbox::default()),
            2,
            1,
            None,
        )
        .unwrap();
        room.sim = Sim::reset_active(
            SimConfig {
                abilities: rh_sim::abilities::Mode::Full,
                ..Default::default()
            },
            rh_sim::arenas::practice_arena(),
            Secrets::from_seed(29),
            &[
                Placement {
                    profile: "owner".into(),
                    faction: FactionId::Fire,
                    bot: false,
                    at: Vec2::new(100., 272.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                },
                Placement {
                    profile: "peer".into(),
                    faction: FactionId::Holy,
                    bot: false,
                    at: Vec2::new(1400., 272.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                },
            ],
        );
        // Transport-only bootstrap of a checkpoint shape already admitted by rh-sim (timerless seeded barrier). This
        // deliberately does not claim a gameplay barrier producer; it gives the enqueue guard an unmistakably nonzero
        // source barrier/ring to retain across the failed and resumed snapshots.
        let mut admitted = serde_json::to_value(&room.sim).unwrap();
        admitted["world"]["players"][0]["core"]["vitals"]["barrier"] = serde_json::json!(30.0);
        admitted["world"]["players"][0]["barrier_until"] = serde_json::json!(0.0);
        admitted["world"]["players"][0]["barrier_decays"] = serde_json::json!(false);
        room.sim = Sim::restore(&admitted).expect("admitted timerless barrier checkpoint form");
        room.sim
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
        for seat in &mut room.humans {
            seat.fx.rebind(&room.sim, seat.player);
            seat.items = rh_sim::ItemObserver::new(seat.player);
        }

        // The first reliable offer commits normal handles and the complete Wish, barrier and combat owner fields.
        room.publish(&[]);
        let initial = decode(&stale);
        let initial_props = initial
            .iter()
            .find_map(|m| match m {
                ServerMsg::State { items, .. } => items.iter().find_map(|item| match item {
                    StateItem::Props(p) => Some(p.clone()),
                    _ => None,
                }),
                _ => None,
            })
            .expect("initial public props");
        let initial_combat = initial
            .iter()
            .find_map(|m| match m {
                ServerMsg::Snapshot {
                    me: Some(me),
                    owner_combat: Some(group),
                    ..
                } if me.wish.is_some() && me.barrier == 30. && me.barrier_ring_step > 0 => {
                    Some(*group)
                }
                _ => None,
            })
            .expect("the actual prepared owner group accompanies Wish and barrier");
        let max_initial = initial_props
            .rows
            .iter()
            .map(|row| row.handle.get())
            .max()
            .unwrap();

        // A newly visible row, owner data, and barrier pair are all staged for a real publish. A closed reliable queue
        // rejects the whole batch; no candidate action handle can resolve before the fresh connection accepts it.
        room.sim
            .seed_weapon_container(
                ContainerKind::Ground,
                Vec2::new(108., 272.),
                &[WeaponId::Bow],
            )
            .unwrap();
        stale.close(RejectCode::TooSlow);
        room.publish(&[]);
        let missing_pickup = rh_sim::validate(rh_sim::RawCommand::MissingPickup).unwrap();
        for raw in max_initial + 1..=max_initial + 3 {
            let proposal = rh_sim::PublicCommand::Pickup {
                handle: rh_sim::PickupHandle::new(raw).unwrap(),
            };
            assert!(
                matches!(room.humans[0].items.resolve(&room.sim, proposal), Ok(command) if command == missing_pickup),
                "uncommitted handle {raw}"
            );
        }

        let fresh = Arc::new(Outbox::default());
        let (reply, resumed) = oneshot::channel();
        room.handle(
            RoomCmd::Resume {
                session: joined.session,
                outbox: fresh.clone(),
                conn: 3,
                reply,
            },
            start,
        );
        assert_eq!(resumed.await.unwrap().unwrap().player, joined.player);
        room.publish(&[]);
        let accepted = decode(&fresh);
        assert!(accepted.iter().any(|m| matches!(m, ServerMsg::Snapshot { me: Some(me), owner_combat: Some(group), .. } if me.wish.is_some() && me.barrier == 30. && me.barrier_ring_step > 0 && *group == initial_combat)));
        let delivered = accepted
            .iter()
            .find_map(|m| match m {
                ServerMsg::State { items, .. } => items.iter().find_map(|item| match item {
                    StateItem::Props(p) => Some(p),
                    _ => None,
                }),
                _ => None,
            })
            .expect("fresh complete props offer");
        let bow = delivered
            .rows
            .iter()
            .find(|row| row.kind == WirePropKind::Ground(1))
            .expect("new Bow row")
            .handle;
        assert_ne!(
            room.humans[0]
                .items
                .resolve(
                    &room.sim,
                    rh_sim::PublicCommand::Pickup {
                        handle: rh_sim::PickupHandle::new(bow.get()).unwrap(),
                    }
                )
                .unwrap(),
            missing_pickup
        );
        assert_eq!(room.frame_refusals, 0);

        fn decode(out: &Outbox) -> Vec<ServerMsg> {
            let mut bytes = Vec::new();
            out.drain_into(&mut bytes);
            bytes
                .iter()
                .map(|frame| ServerMsg::decode(frame).unwrap())
                .collect()
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
                consumables: true,
                faction_mode: rh_sim::FactionMode::EngagementHolyPlagueFire,
                // Off until the coordinator-owned quest transport packet lands; the lifecycle has its own config switch.
                quests: false,
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
    async fn real_trophy_room_enqueue_rejection_does_not_issue_or_spend_handles() {
        use rh_protocol::{
            ClientMsg, RewardChestHandle as WireRewardChestHandle, ServerMsg, StateItem,
            TrophyStatKey, WireCommand, WireRewardChest, WireRewardId,
        };
        use rh_sim::{kill_augments::KillStatKey, reward_chests::RewardChestView, Observation};

        fn rewards(out: &Outbox) -> Vec<WireRewardChest> {
            decoded(out)
                .into_iter()
                .find_map(|message| match message {
                    ServerMsg::State { items, .. } => {
                        items.into_iter().find_map(|item| match item {
                            StateItem::RewardChests(rows) => Some(rows),
                            _ => None,
                        })
                    }
                    _ => None,
                })
                .expect("a full/replacement reward state")
        }

        fn assert_projection(expected: &[RewardChestView], actual: &[WireRewardChest]) {
            assert_eq!(actual.len(), expected.len(), "complete rows are preserved");
            for (view, wire) in expected.iter().zip(actual) {
                assert_eq!(wire.handle.get(), view.handle.wire());
                assert_eq!(wire.x, rh_protocol::quant::quantize_pos(view.at.x as f32));
                assert_eq!(wire.y, rh_protocol::quant::quantize_pos(view.at.y as f32));
                assert_eq!(wire.expires_at, view.expires_at);
                assert_eq!(wire.picked, view.picked);
                assert_eq!(wire.can_choose, view.can_choose);
                assert_eq!(
                    wire.options.len(),
                    view.options.len(),
                    "option slots are not compacted"
                );
                for (source, encoded) in view.options.iter().zip(&wire.options) {
                    assert_eq!(source.taken, encoded.taken);
                    assert_eq!(source.taken_by.map(|id| id.0), encoded.taken_by);
                    match (source.id, encoded.id) {
                        (
                            rh_sim::reward_chests::OptionId::Card(id),
                            WireRewardId::Card(wire_id),
                        ) => {
                            assert_eq!(wire_id, id.index() as u8);
                        }
                        (
                            rh_sim::reward_chests::OptionId::Boost(id),
                            WireRewardId::Boost(wire_id),
                        ) => {
                            assert_eq!(wire_id, id.index() as u8);
                        }
                        (
                            rh_sim::reward_chests::OptionId::Kill(augment),
                            WireRewardId::Kill { key, gain },
                        ) => {
                            let expected_key = match augment.key {
                                KillStatKey::Ad => TrophyStatKey::Ad,
                                KillStatKey::Ap => TrophyStatKey::Ap,
                                KillStatKey::Damage => TrophyStatKey::Damage,
                                KillStatKey::Health => TrophyStatKey::Health,
                                KillStatKey::AttackSpeed => TrophyStatKey::AttackSpeed,
                                KillStatKey::Armor => TrophyStatKey::Armor,
                                KillStatKey::Mr => TrophyStatKey::Mr,
                                KillStatKey::Speed => TrophyStatKey::Speed,
                                KillStatKey::Leech => TrophyStatKey::Leech,
                            };
                            assert_eq!(key, expected_key);
                            assert_eq!(gain.to_bits(), augment.gain.to_bits());
                        }
                        (source, encoded) => {
                            panic!("reward kind/order changed: {source:?} -> {encoded:?}")
                        }
                    }
                }
            }
        }

        fn decoded_choose(handle: WireRewardChestHandle, pick: i8, seq: u32) -> WireCommand {
            let bytes = ClientMsg::Input {
                seq,
                commands: vec![WireCommand::Choose { handle, pick }],
            }
            .try_encode()
            .unwrap();
            let ClientMsg::Input {
                seq: decoded_seq,
                commands,
            } = ClientMsg::decode(&bytes).unwrap()
            else {
                panic!("encoded input did not decode as Input")
            };
            assert_eq!(decoded_seq, seq);
            assert_eq!(commands.len(), 1);
            commands.into_iter().next().unwrap()
        }

        async fn rejected_publish_then_resume_and_choose(fill_queue: bool) {
            let start = Instant::now();
            let tick = Duration::from_millis(50);
            let (mut sim, _) = trophy_fixture::four_seat_validated_pvp_kill();
            // Step through the genuine Trophy birth hold; do not alter/install the container or its outcome.
            let mut events = Vec::new();
            for _ in 0..3 {
                events = sim.step();
            }

            let assets = MapAssets::new(sim.arena().clone()).unwrap();
            let mut config = cfg(tick);
            config.sim = sim.config().clone();
            config.arena = assets.arena;
            config.welcome_map = assets.welcome_map;
            let (reports, _rx) = mpsc::unbounded_channel();
            let mut room = Room::new([13; 16], config, reports, start);
            let rejected = Arc::new(Outbox::default());
            let joined = room
                .join(
                    "p0".into(),
                    Some(FactionId::Fire),
                    rejected.clone(),
                    1,
                    1,
                    None,
                )
                .unwrap();
            let (welcome_protocol, welcome_content) =
                match ServerMsg::decode(&joined.welcome).unwrap() {
                    ServerMsg::Welcome {
                        protocol,
                        content_hash,
                        ..
                    } => (protocol, content_hash),
                    other => panic!("join returned {other:?}, expected Welcome"),
                };
            assert_eq!(welcome_protocol, rh_protocol::PROTOCOL_VERSION);
            let mut peer_outboxes = Vec::new();
            for player in 1..4 {
                let out = Arc::new(Outbox::default());
                room.join(
                    format!("p{player}"),
                    Some(FactionId::Fire),
                    out.clone(),
                    10 + player as u64,
                    1,
                    None,
                )
                .unwrap();
                peer_outboxes.push(out);
            }
            room.sim = sim;
            for seat in &mut room.humans {
                seat.fx.rebind(&room.sim, seat.player);
                seat.items = rh_sim::ItemObserver::new(seat.player);
            }

            let mut owner_observer = rh_sim::ItemObserver::new(PlayerId(1));
            let mut owner_view = Observation::default();
            owner_observer
                .observe_into(&room.sim, &events, &mut owner_view, None)
                .unwrap();
            let candidate = owner_view
                .reward_chests
                .iter()
                .find(|row| {
                    row.options
                        .iter()
                        .any(|option| matches!(option.id, rh_sim::reward_chests::OptionId::Kill(_)))
                })
                .expect("the actual credited kill produced an owner Trophy")
                .clone();
            assert!(
                candidate.can_choose,
                "the real Trophy is past its ordinary hold"
            );
            let peer = PlayerId(3);
            let mut stranger_observer = rh_sim::ItemObserver::new(peer);
            let mut stranger_view = Observation::default();
            stranger_observer
                .observe_into(&room.sim, &events, &mut stranger_view, None)
                .unwrap();
            assert!(
                stranger_view.reward_chests.iter().all(|row| row
                    .options
                    .iter()
                    .all(|option| !matches!(option.id, rh_sim::reward_chests::OptionId::Kill(_)))),
                "the native owner filter hides Trophy options before Room publication"
            );

            if fill_queue {
                for _ in 0..crate::outbox::IMPORTANT_CAP {
                    rejected.important(vec![0x99]);
                }
            } else {
                rejected.close(RejectCode::TooSlow);
            }
            let after_fill = rejected.pending();
            room.publish(&events);
            assert_eq!(
                rejected.pending(),
                after_fill,
                "refused Room batch adds no reliable state/snapshot"
            );
            let mut stale_frames = Vec::new();
            let refused = rejected.drain_into(&mut stale_frames);
            assert_eq!(refused.close, Some(RejectCode::TooSlow));
            assert_eq!(
                stale_frames.len(),
                if fill_queue {
                    crate::outbox::IMPORTANT_CAP
                } else {
                    0
                }
            );
            if fill_queue {
                assert!(
                    stale_frames.iter().all(|frame| frame == &[0x99]),
                    "refused Trophy frame was not queued"
                );
            }

            let candidate_handle =
                rh_protocol::RewardChestHandle::new(candidate.handle.wire()).unwrap();
            let absent = room.humans[0]
                .items
                .resolve(
                    &room.sim,
                    rh_sim::PublicCommand::Choose {
                        handle: candidate.handle,
                        pick: 0,
                    },
                )
                .unwrap();
            assert_eq!(
                absent,
                rh_sim::validate(rh_sim::RawCommand::Choose {
                    chest_id: None,
                    pick: 0
                })
                .unwrap(),
                "a merely prepared candidate handle has no seat binding"
            );
            let chosen = match candidate.options.iter().find_map(|option| match option.id {
                rh_sim::reward_chests::OptionId::Kill(augment) => Some(augment),
                _ => None,
            }) {
                Some(augment) => augment,
                None => unreachable!(),
            };
            let before = room
                .sim
                .player(PlayerId(1))
                .unwrap()
                .kill_stats
                .get(chosen.key);
            room.handle(
                RoomCmd::Input {
                    received: std::time::Instant::now(),
                    player: PlayerId(1),
                    conn: 1,
                    seq: 1,
                    commands: vec![decoded_choose(candidate_handle, 0, 1)],
                },
                start,
            );
            assert!(room.wake(start + tick));
            assert_eq!(
                room.sim
                    .player(PlayerId(1))
                    .unwrap()
                    .kill_stats
                    .get(chosen.key),
                before,
                "a Choose against the uncommitted candidate cannot grant or spend the Trophy"
            );

            let fresh = Arc::new(Outbox::default());
            let (reply, resumed) = oneshot::channel();
            room.handle(
                RoomCmd::Resume {
                    session: joined.session,
                    outbox: fresh.clone(),
                    conn: 5,
                    reply,
                },
                start + tick,
            );
            let resumed = resumed.await.unwrap().unwrap();
            match ServerMsg::decode(&resumed.welcome).unwrap() {
                ServerMsg::Welcome {
                    protocol,
                    content_hash,
                    ..
                } => {
                    assert_eq!(protocol, welcome_protocol);
                    assert_eq!(
                        content_hash, welcome_content,
                        "resume uses the same content identity"
                    );
                }
                other => panic!("resume returned {other:?}, expected Welcome"),
            }
            room.publish(&[]);
            let accepted_rows = rewards(&fresh);
            let mut final_observer = rh_sim::ItemObserver::new(PlayerId(1));
            let mut final_view = Observation::default();
            final_observer
                .observe_into(&room.sim, &[], &mut final_view, None)
                .unwrap();
            assert_projection(&final_view.reward_chests, &accepted_rows);
            let accepted_trophy = accepted_rows
                .iter()
                .find(|row| {
                    row.options
                        .iter()
                        .any(|option| matches!(option.id, WireRewardId::Kill { .. }))
                })
                .expect("reliable Room queue carries Trophy");
            assert_eq!(
                accepted_trophy.handle.get(),
                candidate.handle.wire(),
                "failed enqueue did not consume/advance the unpublished handle"
            );
            assert!(!peer_outboxes.is_empty());
            assert!(
                peer_outboxes.iter().all(|out| {
                    let rows = rewards(out);
                    rows.iter().all(|row| {
                        row.options
                            .iter()
                            .all(|option| !matches!(option.id, WireRewardId::Kill { .. }))
                    })
                }),
                "every stranger Room queue carries no private Trophy option"
            );

            // The normal wire Choose command reaches Room intake, seat binding, validation and Sim::submit.
            // Select the last actual option so the check follows its original array position through publication.
            let pick = i8::try_from(accepted_trophy.options.len() - 1).unwrap();
            let WireRewardId::Kill { key, gain } = accepted_trophy.options[pick as usize].id else {
                panic!("selected option is not the decoded Trophy choice")
            };
            let stat = match key {
                TrophyStatKey::Ad => KillStatKey::Ad,
                TrophyStatKey::Ap => KillStatKey::Ap,
                TrophyStatKey::Damage => KillStatKey::Damage,
                TrophyStatKey::Health => KillStatKey::Health,
                TrophyStatKey::AttackSpeed => KillStatKey::AttackSpeed,
                TrophyStatKey::Armor => KillStatKey::Armor,
                TrophyStatKey::Mr => KillStatKey::Mr,
                TrophyStatKey::Speed => KillStatKey::Speed,
                TrophyStatKey::Leech => KillStatKey::Leech,
            };
            let before = room.sim.player(PlayerId(1)).unwrap().kill_stats.get(stat);
            room.handle(
                RoomCmd::Input {
                    received: std::time::Instant::now(),
                    player: PlayerId(1),
                    conn: 5,
                    seq: 2,
                    commands: vec![decoded_choose(accepted_trophy.handle, pick, 2)],
                },
                start + tick,
            );
            assert!(room.wake(start + tick * 2));
            let after = room.sim.player(PlayerId(1)).unwrap().kill_stats.get(stat);
            assert_eq!(
                after.to_bits(),
                (before + gain).to_bits(),
                "grant is exactly the delivered gain at the selected slot"
            );
        }

        rejected_publish_then_resume_and_choose(false).await;
        rejected_publish_then_resume_and_choose(true).await;
    }

    #[test]
    fn catch_up_carries_a_real_wish_start_from_its_visible_step() {
        use rh_protocol::{WireCommand, WireFx};
        use rh_sim::{FactionId, Placement, Vec2};

        let now = Instant::now();
        let tick = Duration::from_millis(50);
        let (tx, _) = mpsc::unbounded_channel();
        let mut config = cfg(tick);
        config.sim.abilities = rh_sim::abilities::Mode::Full;
        let mut room = Room::new([9; 16], config, tx, now);
        let viewer_out = Arc::new(Outbox::default());
        let caster_out = Arc::new(Outbox::default());
        let viewer = room
            .join(
                "viewer".into(),
                Some(FactionId::Fire),
                viewer_out.clone(),
                1,
                1,
                None,
            )
            .unwrap();
        let caster = room
            .join(
                "caster".into(),
                Some(FactionId::Plague),
                caster_out.clone(),
                2,
                1,
                None,
            )
            .unwrap();
        room.sim = Sim::reset_active(
            SimConfig {
                abilities: rh_sim::abilities::Mode::Full,
                wish_lock_ms: 0.,
                ..Default::default()
            },
            rh_sim::arenas::practice_arena(),
            Secrets::from_seed(17),
            &[
                Placement {
                    profile: "viewer".into(),
                    faction: FactionId::Fire,
                    bot: false,
                    at: Vec2::new(400., 272.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                },
                Placement {
                    profile: "caster".into(),
                    faction: FactionId::Plague,
                    bot: false,
                    at: Vec2::new(1290., 272.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                },
            ],
        );
        for human in &mut room.humans {
            human.fx.rebind(&room.sim, human.player);
        }

        let mut tracker = rh_protocol::SnapshotTracker::new();
        assert!(room.wake(now + tick));
        let mut initial_frames = Vec::new();
        viewer_out.drain_into(&mut initial_frames);
        for frame in &initial_frames {
            tracker.decode(frame).unwrap();
        }
        let _ = drain(&caster_out);
        // The viewer is 890 units from the caster: visible at the cast's source step, then walks outside the 900-unit
        // radius during this single three-step wake. The cast is validated/submitted as a native command, then the Room's
        // normal per-step projector and publisher carry the genuine producer event to the connection.
        room.handle(
            RoomCmd::Input {
                received: std::time::Instant::now(),
                player: viewer.player,
                conn: 1,
                seq: 1,
                commands: vec![WireCommand::Move {
                    x: 100.,
                    y: 272.,
                    seq: None,
                }],
            },
            now + tick,
        );
        room.sim
            .submit(
                caster.player,
                rh_sim::validate(rh_sim::RawCommand::Cast {
                    slot: rh_sim::abilities::Slot::Wish,
                    x: 1290.,
                    y: 272.,
                    id: None,
                    t: None,
                    seq: None,
                })
                .unwrap(),
            )
            .unwrap();
        assert!(room.wake(now + tick * 4));

        let mut catchup_frames = Vec::new();
        viewer_out.drain_into(&mut catchup_frames);
        let messages = catchup_frames
            .iter()
            .map(|frame| tracker.decode(frame).unwrap())
            .collect::<Vec<_>>();
        let mut saw_start = false;
        let mut final_actors = None;
        for message in messages {
            match message {
                ServerMsg::Fx { fx, .. } => {
                    saw_start |= fx
                        .iter()
                        .any(|event| matches!(event, WireFx::WishStarted { ability: 1, .. }));
                }
                ServerMsg::Snapshot {
                    phase: 1, actors, ..
                } => final_actors = Some(actors),
                _ => {}
            }
        }
        assert!(
            saw_start,
            "the cast was visible at its own step and carried to the wake frame"
        );
        assert!(final_actors.expect("final active snapshot").iter().all(|actor| actor.id != caster.player.0),
            "the caster is outside final visibility, so a final-world re-filter would drop the earlier cue");
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

    fn training_cfg(tick: Duration) -> RoomConfig {
        let assets = MapAssets::new(rh_sim::arenas::practice_arena()).unwrap();
        RoomConfig {
            sim: SimConfig {
                walk_hints: None,
                lag_fairness: false,
                regen: false,
                quests: false,
                consumables: true,
                training: true,
                dummies: true,
                abilities: rh_sim::abilities::Mode::Off,
                wish_lock_ms: rh_sim::abilities::WISH_LOCK_MS,
                hazards: rh_sim::terrain::Mode::Off,
                lifecycle: rh_sim::ArenaMode::Off,
                mob_mode: rh_sim::mob_runtime::MobMode::Off,
                initial_loot: false,
                min_players: 1,
                lobby_seconds: 0.0,
                fill_seconds: 0.0,
                pvp_rules: true,
                weapon_specials: true,
                faction_mode: rh_sim::FactionMode::Off,
            },
            arena: assets.arena,
            welcome_map: assets.welcome_map,
            // Deliberately nonzero: a training room must never fill bots even if a hosting config asks for them.
            fill_bots_to: 4,
            tick,
            // Deliberately true: a training room must never record a replay (no banking/telemetry of a run).
            record: true,
            fixed_secrets: Some(Secrets::from_seed(7)),
            fixed_bot_seed: Some(7),
            reconnect_grace: RECONNECT_GRACE,
            linger: LINGER,
        }
    }

    fn decoded(out: &Outbox) -> Vec<rh_protocol::ServerMsg> {
        let mut raw = Vec::new();
        let _ = out.drain_into(&mut raw);
        raw.iter()
            .map(|f| rh_protocol::ServerMsg::decode(f).unwrap())
            .collect()
    }

    fn training_room(start: Instant, reports: mpsc::UnboundedSender<RoomReport>) -> Room {
        Room::new(
            [9; 16],
            training_cfg(Duration::from_millis(50)),
            reports,
            start,
        )
    }

    #[tokio::test(start_paused = true)]
    async fn a_training_room_starts_active_with_one_human_and_a_training_stream() {
        let start = Instant::now();
        let (reports, _rx) = mpsc::unbounded_channel();
        let mut room = training_room(start, reports);
        assert!(
            room.recorder.is_none(),
            "a training room never records a replay"
        );
        assert_eq!(room.fill_to, 0, "no bots fill a practice room");
        let out = Arc::new(Outbox::default());
        let joined = room
            .join(
                "practice".into(),
                Some(FactionId::Holy),
                out.clone(),
                1,
                1,
                None,
            )
            .expect("the one seat");
        assert!(
            matches!(
                room.join(
                    "second".into(),
                    None,
                    Arc::new(Outbox::default()),
                    2,
                    2,
                    None
                ),
                Err(RejectCode::MatchFull)
            ),
            "a training room seats exactly one human"
        );
        assert!(room.wake(start + Duration::from_millis(50)));
        assert_eq!(room.sim().phase(), Phase::Active);
        assert_eq!(
            room.sim().mobs().len(),
            2,
            "the practice setup's plain and shield dummy"
        );
        let frames = decoded(&out);
        assert!(
            frames
                .iter()
                .any(|m| matches!(m, rh_protocol::ServerMsg::Snapshot { training: true, .. })),
            "the live stream carries the training bit: {frames:?}"
        );
        let _ = joined.player;
    }

    #[tokio::test(start_paused = true)]
    async fn a_training_room_closes_on_idle_and_banks_nothing() {
        let start = Instant::now();
        let tick = Duration::from_millis(50);
        let (reports, mut rx) = mpsc::unbounded_channel();
        let mut room = training_room(start, reports);
        room.training_idle = Duration::from_millis(300);
        let out = Arc::new(Outbox::default());
        room.join(
            "practice".into(),
            Some(FactionId::Holy),
            out.clone(),
            1,
            1,
            None,
        )
        .expect("one seat");
        assert!(
            room.wake(start + tick),
            "the lobby closes into the practice run"
        );
        assert!(
            room.wake(start + Duration::from_millis(250)),
            "inside the idle limit"
        );
        assert!(
            !room.wake(start + Duration::from_millis(400)),
            "the training idle limit closes the room"
        );
        let (mut closed, mut saw_result) = (None, false);
        while let Ok(r) = rx.try_recv() {
            match r {
                RoomReport::Closed { replay, .. } => closed = Some(replay),
                RoomReport::Result { .. } => saw_result = true,
                _ => {}
            }
        }
        assert!(!saw_result, "a training room never reports a result");
        let closed = closed.expect("the room reported Closed");
        assert!(
            closed.is_none(),
            "no replay is recorded for a training room"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_training_room_idle_clock_counts_accepted_inputs_only() {
        let start = Instant::now();
        let tick = Duration::from_millis(50);
        let (reports, _rx) = mpsc::unbounded_channel();
        let mut room = training_room(start, reports);
        room.training_idle = Duration::from_millis(300);
        let out = Arc::new(Outbox::default());
        let joined = room
            .join(
                "practice".into(),
                Some(FactionId::Holy),
                out.clone(),
                1,
                1,
                None,
            )
            .expect("one seat");
        assert!(room.wake(start + tick));
        room.handle(
            RoomCmd::Input {
                received: std::time::Instant::now(),
                player: joined.player,
                conn: 1,
                seq: 1,
                commands: vec![rh_protocol::WireCommand::Aim { a: 0.0 }],
            },
            start + Duration::from_millis(100),
        );
        assert!(
            room.wake(start + Duration::from_millis(350)),
            "an accepted input resets the idle clock"
        );
        assert!(
            !room.wake(start + Duration::from_millis(500)),
            "the room closes 300 ms after the last accepted input"
        );
    }

    /// Latency-budget telemetry: the age of an Input at the step that applies it, the rewind clamps by edge, and the step
    /// start stamped on the tick batch the writer drains.
    #[tokio::test(start_paused = true)]
    async fn input_age_clamps_and_the_step_stamp_reach_the_metrics() {
        let start = Instant::now();
        let tick = Duration::from_millis(50);
        let (reports, _rx) = mpsc::unbounded_channel();
        let metrics: &'static Metrics = Box::leak(Box::new(Metrics::new()));
        let mut room = training_room(start, reports).with_metrics(metrics);
        let out = Arc::new(Outbox::default());
        let joined = room
            .join(
                "practice".into(),
                Some(FactionId::Holy),
                out.clone(),
                1,
                1,
                None,
            )
            .expect("one seat");
        assert!(room.wake(start + tick));
        let mut batch = Vec::new();
        let d = out.drain_into(&mut batch);
        assert!(
            d.step_started.is_some(),
            "a tick batch carries its step start"
        );
        assert_eq!(metrics.input_age_us.count(), 0, "no input yet");
        let received = std::time::Instant::now() - Duration::from_millis(30);
        room.handle(
            RoomCmd::Input {
                received,
                player: joined.player,
                conn: 1,
                seq: 1,
                commands: vec![
                    rh_protocol::WireCommand::Aim { a: 0.0 },
                    rh_protocol::WireCommand::Attack {
                        a: 0.0,
                        t: Some(1.0e9),
                    },
                ],
            },
            start + tick,
        );
        assert!(room.wake(start + tick * 2));
        assert_eq!(
            metrics.input_age_us.count(),
            1,
            "one value per seat per step"
        );
        assert!(metrics.input_age_us.max() >= 30_000);
        assert_eq!(metrics.rewind_clamps_future.load(Ordering::Relaxed), 1);
        assert_eq!(metrics.rewind_clamps_old.load(Ordering::Relaxed), 0);
        assert_eq!(metrics.rewind_clamp_excess[3].load(Ordering::Relaxed), 1);
        assert!(room.wake(start + tick * 3));
        assert_eq!(metrics.input_age_us.count(), 1, "an input is aged once");
    }

    #[tokio::test(start_paused = true)]
    async fn a_forged_move_stamp_is_clamped_counted_and_still_walks() {
        let start = Instant::now();
        let tick = Duration::from_millis(50);
        let (reports, _rx) = mpsc::unbounded_channel();
        let metrics: &'static Metrics = Box::leak(Box::new(Metrics::new()));
        let mut room = training_room(start, reports).with_metrics(metrics);
        let out = Arc::new(Outbox::default());
        let joined = room
            .join(
                "practice".into(),
                Some(FactionId::Holy),
                out.clone(),
                1,
                1,
                None,
            )
            .expect("one seat");
        for k in 1..=3 {
            assert!(room.wake(start + tick * k));
        }
        let from = room.sim.player(joined.player).unwrap().pos();
        room.handle(
            RoomCmd::Input {
                received: std::time::Instant::now(),
                player: joined.player,
                conn: 1,
                seq: 1,
                commands: vec![rh_protocol::WireCommand::MoveAt {
                    x: (from.x + 300.0) as f32,
                    y: from.y as f32,
                    seq: Some(1),
                    t: -1.0e9,
                }],
            },
            start + tick * 3,
        );
        assert!(room.wake(start + tick * 4));
        assert_eq!(metrics.rewind_clamps_old.load(Ordering::Relaxed), 1);
        assert_eq!(metrics.rewind_clamps_future.load(Ordering::Relaxed), 0);
        let to = room.sim.player(joined.player).unwrap().pos();
        assert!(to.x > from.x, "the clamped order was submitted and walked");
    }

    /// A room built from the live runtime profile plays with lag fairness: a stamped order from an idle seat walks its
    /// credit (up to one extra tick), where the same order unstamped walks one tick.
    #[tokio::test(start_paused = true)]
    async fn a_live_runtime_room_has_lag_fairness_and_credits_a_stamped_order() {
        let live = crate::runtime::Settings::from_args(&["--runtime".into(), "training".into()])
            .unwrap()
            .unwrap()
            .sim();
        assert!(live.lag_fairness);
        let start = Instant::now();
        let tick = Duration::from_millis(50);
        let walked = |stamped: bool| {
            let (reports, _rx) = mpsc::unbounded_channel();
            let mut room = Room::new(
                [9; 16],
                RoomConfig {
                    sim: live.clone(),
                    ..training_cfg(tick)
                },
                reports,
                start,
            );
            assert!(room.sim.config().lag_fairness, "the live room has it on");
            let joined = room
                .join(
                    "practice".into(),
                    Some(FactionId::Holy),
                    Arc::new(Outbox::default()),
                    1,
                    1,
                    None,
                )
                .expect("one seat");
            for k in 1..=3 {
                assert!(room.wake(start + tick * k));
            }
            let from = room.sim.player(joined.player).unwrap().pos();
            let (x, y) = ((from.x + 300.0) as f32, from.y as f32);
            let command = if stamped {
                rh_protocol::WireCommand::MoveAt {
                    x,
                    y,
                    seq: Some(1),
                    t: room.sim.server_time() - 1.0e6,
                }
            } else {
                rh_protocol::WireCommand::Move { x, y, seq: Some(1) }
            };
            room.handle(
                RoomCmd::Input {
                    received: std::time::Instant::now(),
                    player: joined.player,
                    conn: 1,
                    seq: 1,
                    commands: vec![command],
                },
                start + tick * 3,
            );
            assert!(room.wake(start + tick * 4));
            let to = room.sim.player(joined.player).unwrap().pos();
            (to.x - from.x).hypot(to.y - from.y)
        };
        let (plain, credited) = (walked(false), walked(true));
        assert!(plain > 0.0);
        assert!(
            (credited - 2.0 * plain).abs() < 1e-6,
            "a forged stamp buys exactly the one-tick cap: {credited} vs {plain}"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_training_room_leave_never_banks_a_mia_result() {
        let start = Instant::now();
        let tick = Duration::from_millis(50);
        let (reports, mut rx) = mpsc::unbounded_channel();
        let mut room = training_room(start, reports);
        let out = Arc::new(Outbox::default());
        let joined = room
            .join(
                "practice".into(),
                Some(FactionId::Holy),
                out.clone(),
                1,
                1,
                None,
            )
            .expect("one seat");
        assert!(room.wake(start + tick));
        // Leaving during the practice run resolves the sim's MIA result between ticks; the room must drop it entirely.
        room.handle(
            RoomCmd::Leave {
                player: joined.player,
                conn: 1,
            },
            start + tick,
        );
        assert!(!room.wake(start + 3 * tick), "the only human left");
        let mut saw_result = false;
        let mut closed = None;
        while let Ok(r) = rx.try_recv() {
            match r {
                RoomReport::Result { .. } => saw_result = true,
                RoomReport::Closed { replay, .. } => closed = Some(replay),
                _ => {}
            }
        }
        assert!(
            !saw_result,
            "a leaving practice player is not a banked result"
        );
        assert!(closed.is_some());
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
                .map(|p| (p.seat.name.clone(), p.faction(), p.seat.bot))
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
    fn a_bot_result_report_carries_its_fill_spec_once() {
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
        // Source BotManager.onResult's ended guard: a repeated native event must not train the cell twice.
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
        assert!(
            rx.try_recv().is_err(),
            "one managed seat records at most one result"
        );
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
