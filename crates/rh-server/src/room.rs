//! One match: a task that owns its [`Sim`], its seats and its pacer. Everything that touches the simulation happens on this
//! task, in arrival order, between steps (the legacy rule: handlers validate and enqueue, the sim consumes at the next step).
//! Nothing here blocks on I/O: frames go to per-connection [`Outbox`]es, results to a channel drained off-tick.

use crate::metrics::{self, Histogram, Metrics};
use crate::outbox::{Outbox, OutboxCounters};
use crate::pacer::Pacer;
use crate::wire;
use rh_policy::{drive_seats_with, scripted, Seat};
use rh_protocol::map::{EncodedMap, MapBlob};
use rh_protocol::{encode_welcome, RejectCode, WelcomeHeader};
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

pub struct JoinOk {
    pub player: PlayerId,
    pub session: [u8; 16],
    pub welcome: Vec<u8>,
    /// The room's latest simulation time (f64 bits), for Pong.
    pub clock: Arc<AtomicU64>,
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
}

/// What the room reports to its owner (the director): free a profile, a result to persist, the room closed.
#[derive(Debug)]
pub enum RoomReport {
    /// A human left its seat. `result_pending`: it left a run it was still standing in, so its (MIA) result follows in a
    /// `Result` report; the director keeps the profile reserved until that result is written.
    Left {
        profile: String,
        fence: i64,
        result_pending: bool,
    },
    /// `fence`: the session-lease fence the result was earned under (None for a bot).
    Result {
        match_id: MatchId,
        profile: String,
        bot: bool,
        fence: Option<i64>,
        result: RunResult,
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
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct RoomStats {
    pub ticks: u64,
    /// Step wall-time quantiles in microseconds, from a log-linear histogram: p50 and p99 are bucket upper bounds (never
    /// below the true value, at most 25% above it); the max is exact.
    pub step_us_p50: u64,
    pub step_us_p99: u64,
    pub step_us_max: u64,
    pub late_wakes: u64,
    pub dropped_steps: u64,
    /// Bytes of every frame the room encoded for its humans.
    pub bytes_out: u64,
    /// Bytes of the frames the outboxes accepted (at most `bytes_out`: a closed outbox takes nothing).
    pub bytes_enqueued_total: u64,
    /// Fx frames evicted unsent from slow clients' outboxes, over every connection the match had.
    pub fx_dropped: u64,
    /// Snapshots a slow client skipped because a newer one replaced them.
    pub snapshots_skipped: u64,
    /// Snapshots the encoder refused to send (never a repaired frame): counted here, logged once per room.
    pub snapshot_refusals: u64,
    /// Refusal log lines printed: at most one per room, however many refusals there were.
    pub snapshot_refusals_logged: u64,
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

struct HumanSeat {
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
    reports: mpsc::UnboundedSender<RoomReport>,
    clock: Arc<AtomicU64>,
    /// Step wall times: a fixed-size histogram (384 bytes at any uptime; was a Vec growing to 288 KB).
    step_us: Histogram,
    metrics: &'static Metrics,
    bytes_out: u64,
    snapshot_refusals: u64,
    snapshot_refusals_logged: u64,
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
    fences: Vec<(PlayerId, i64)>,
    reported_phase: Phase,
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
        let recorder = cfg
            .record
            .then(|| Recorder::new(&sim, cfg.sim, ReplayStart::Lobby));
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
            reports,
            clock: Arc::new(AtomicU64::new(0f64.to_bits())),
            step_us: Histogram::new(),
            metrics: metrics::process(),
            bytes_out: 0,
            snapshot_refusals: 0,
            snapshot_refusals_logged: 0,
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
        match cmd {
            RoomCmd::Join {
                profile,
                faction,
                outbox,
                conn,
                fence,
                reply,
            } => {
                let r = self.join(profile, faction, outbox, conn, fence);
                let _ = reply.send(r);
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
                        let old = h.outbox.replace(outbox);
                        // From now on only the new connection speaks for this seat.
                        h.conn = conn;
                        h.dropped_at = None;
                        let (player, session) = (h.player, h.session);
                        if let Some(old) = old {
                            old.close(RejectCode::Kicked);
                            self.retire_outbox(&old);
                        }
                        self.record(ReplayInput::Dropped {
                            player,
                            dropped: false,
                        });
                        self.sim.mark_dropped(player, false);
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
                }
            }
            RoomCmd::Leave { player, conn } => {
                if self
                    .humans
                    .iter()
                    .any(|h| h.player == player && h.conn == conn)
                {
                    self.leave(player);
                }
            }
            RoomCmd::Drain => self.draining = true,
        }
    }

    fn join(
        &mut self,
        profile: String,
        faction: Option<FactionId>,
        outbox: Arc<Outbox>,
        conn: u64,
        fence: i64,
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
                self.bots.retain(|s| s.player != bot);
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
        self.fences.push((player, fence));
        // A room that has had a human closes the moment it has none again (see `wake`).
        self.had_human = true;
        self.humans.push(HumanSeat {
            player,
            conn,
            fence,
            profile,
            session,
            outbox: Some(outbox),
            dropped_at: None,
            ack_input: 0,
            carry: Vec::new(),
        });
        self.fill_bots();
        let _ = self.reports.send(RoomReport::Seated {
            match_id: self.id,
            phase: self.sim.phase(),
            humans: self.humans_present(),
        });
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
                id,
                Box::new(scripted::Brawler::new(interval)),
                Box::new(scripted::Idle),
                seed,
            ));
        }
    }

    fn leave(&mut self, player: PlayerId) {
        if let Some(i) = self.humans.iter().position(|h| h.player == player) {
            let h = self.humans.remove(i);
            if let Some(o) = h.outbox {
                o.close(RejectCode::Kicked);
                self.retire_outbox(&o);
            }
            // Leaving a run one still stands in is MIA: the sim resolves it now and its result is reported with the next
            // step's events; the director holds the profile until it is written.
            let result_pending = self.sim.phase() == Phase::Active
                && self.sim.player(player).is_some_and(|p| !p.resolved);
            self.record(ReplayInput::Leave { player });
            self.sim.remove_player(player);
            let _ = self.reports.send(RoomReport::Left {
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
            self.leave(p);
        }
        if self.humans.is_empty()
            && self.sim.phase() != Phase::Ended
            && (self.had_human || now.duration_since(self.opened_at) >= UNCLAIMED_TIMEOUT)
        {
            // Nobody left to play for: a lobby closes; a run's remaining players are all bots or gone. A room nobody has
            // joined yet waits for its first player (its admission may be acquiring a durable lease off the tick).
            return self.close();
        }
        let slot = self.pacer.next_deadline();
        let dropped_before = self.pacer.dropped;
        let steps = self.pacer.due(now);
        if steps == 0 {
            return true;
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
        self.metrics.lateness_us.record(
            now.saturating_duration_since(slot)
                .as_micros()
                .min(u128::from(u32::MAX)) as u32,
        );
        self.wake_events.clear();
        for n in 0..steps {
            let t = std::time::Instant::now();
            let rec = &mut self.recorder;
            drive_seats_with(
                &mut self.sim,
                &mut self.bots,
                &self.last_events,
                |player, cmd| {
                    if let Some(r) = rec.as_mut() {
                        r.record(ReplayInput::Command { player, cmd });
                    }
                },
            );
            self.step_events.clear();
            self.sim.step_into(&mut self.step_events);
            let us = t.elapsed().as_micros().min(u32::MAX as u128) as u32;
            if let Some(r) = self.recorder.as_mut() {
                r.stepped(&self.sim);
            }
            self.step_us.record(us);
            self.metrics.step_us.record(us);
            if n + 1 < steps {
                // C-OBS on a catch-up wake: this step's events are judged against THIS step's line of sight, now, not
                // against the last step's (an attacker who steps out of sight in a later step must not hide its swing,
                // and one who steps into sight must not reveal an earlier one). One snapshot still goes out, for the
                // final state.
                for h in &mut self.humans {
                    if h.outbox.is_some() {
                        rh_sim::observe_events_into(
                            &self.sim,
                            h.player,
                            &self.step_events,
                            &mut h.carry,
                        );
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
            let frames = self.publisher.frames(
                &self.sim,
                h.player,
                h.ack_input,
                &self.last_events,
                &mut h.carry,
                events,
            );
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
            let bytes: usize = [&frames.important, &frames.fx, &snap]
                .into_iter()
                .flatten()
                .map(Vec::len)
                .sum();
            if bytes > 0 {
                self.bytes_out += bytes as u64;
                bytes_total += bytes as u64;
                pushes += 1;
                // One lock and one notify for the client's whole tick.
                out.push_tick(frames.important, frames.fx, snap);
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

    /// Every resolved result goes to the director (durable storage), with the fence it was earned under.
    fn report_results(&self, events: &[Event]) {
        for e in events {
            if let Event::Resolved { id, result, bot } = e {
                let fence = if *bot {
                    None
                } else {
                    self.fences.iter().find(|(p, _)| p == id).map(|(_, f)| *f)
                };
                let _ = self.reports.send(RoomReport::Result {
                    match_id: self.id,
                    profile: result.profile.clone(),
                    bot: *bot,
                    fence,
                    result: result.clone(),
                });
            }
        }
    }

    fn close(&mut self) -> bool {
        // Results emitted between steps (the last human's MIA leave) would otherwise die with the room.
        let pending = self.sim.take_events();
        self.report_results(&pending);
        for h in std::mem::take(&mut self.humans) {
            if let Some(o) = &h.outbox {
                o.close(RejectCode::Kicked);
                self.retire_outbox(o);
            }
            let _ = self.reports.send(RoomReport::Left {
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
            snapshot_refusals: self.snapshot_refusals,
            snapshot_refusals_logged: self.snapshot_refusals_logged,
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
/// [`Sleep`]: tokio::time::Sleep
pub async fn run_room(mut room: Room, mut rx: mpsc::Receiver<RoomCmd>) {
    let mut armed = room.next_deadline();
    let sleep = tokio::time::sleep_until(armed);
    tokio::pin!(sleep);
    loop {
        tokio::select! {
            biased;
            _ = &mut sleep => {
                if !room.wake(Instant::now()) { return; }
                // The sleep has fired: arm it for the next slot (a wake that ran no step leaves the slot where it was,
                // and re-arming it then behaves as a fresh `sleep_until`, as before).
                armed = room.next_deadline();
                sleep.as_mut().reset(armed);
            }
            cmd = rx.recv() => match cmd {
                Some(cmd) => {
                    room.handle(cmd, Instant::now());
                    let next = room.next_deadline();
                    if next != armed {
                        armed = next;
                        sleep.as_mut().reset(armed);
                    }
                }
                None => { room.close(); return; }
            },
        }
    }
}
