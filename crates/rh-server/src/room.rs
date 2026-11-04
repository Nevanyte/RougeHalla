//! One match: a task that owns its [`Sim`], its seats and its pacer. Everything that touches the simulation happens on this
//! task, in arrival order, between steps (the legacy rule: handlers validate and enqueue, the sim consumes at the next step).
//! Nothing here blocks on I/O: frames go to per-connection [`Outbox`]es, results to a channel drained off-tick.

use crate::outbox::Outbox;
use crate::pacer::Pacer;
use crate::wire;
use rh_policy::{drive_seats_with, scripted, Seat};
use rh_protocol::{RejectCode, ServerMsg, WireEvent};
use rh_sim::replay::{BotPolicy, Recorder, Replay, ReplayInput, ReplayStart};
use rh_sim::{Event, FactionId, Phase, PlayerId, RunResult, Secrets, Sim, SimConfig};
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
    Phase {
        match_id: MatchId,
        phase: Phase,
        humans: usize,
    },
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct RoomStats {
    pub ticks: u64,
    pub step_us_p50: u64,
    pub step_us_p99: u64,
    pub step_us_max: u64,
    pub late_wakes: u64,
    pub dropped_steps: u64,
    pub bytes_out: u64,
    pub fx_dropped: u64,
    pub snapshots_skipped: u64,
}

pub struct RoomConfig {
    pub sim: SimConfig,
    pub arena: rh_sim::Arena,
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
}

pub struct Room {
    pub id: MatchId,
    sim: Sim,
    humans: Vec<HumanSeat>,
    bots: Vec<Seat>,
    fill_to: usize,
    pacer: Pacer,
    last_events: Vec<Event>,
    reports: mpsc::UnboundedSender<RoomReport>,
    clock: Arc<AtomicU64>,
    step_us: Vec<u32>,
    bytes_out: u64,
    ended_at: Option<Instant>,
    draining: bool,
    welcome_map: rh_protocol::map::MapBlob,
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
        let m = &cfg.arena.map;
        let welcome_map = rh_protocol::map::MapBlob::new(m.w as u16, m.h as u16, m.tiles.clone());
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
            reports,
            clock: Arc::new(AtomicU64::new(0f64.to_bits())),
            step_us: Vec::with_capacity(4096),
            bytes_out: 0,
            ended_at: None,
            draining: false,
            welcome_map,
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

    fn record(&mut self, input: ReplayInput) {
        if let Some(r) = self.recorder.as_mut() {
            r.record(input);
        }
    }

    pub fn sim(&self) -> &Sim {
        &self.sim
    }

    fn welcome(&self, player: PlayerId, session: [u8; 16]) -> Vec<u8> {
        ServerMsg::Welcome {
            protocol: rh_protocol::PROTOCOL_VERSION,
            content_hash: rh_sim::content::content_hash(),
            match_id: self.id,
            player_id: player.0,
            session,
            tick_rate: rh_sim::constants::TICK_RATE as u8,
            tick: self.sim.tick,
            server_ms: self.sim.server_time,
            map: self.welcome_map.clone(),
        }
        .encode()
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
                        if let Some(old) = h.outbox.replace(outbox) {
                            old.close(RejectCode::Kicked);
                        }
                        // From now on only the new connection speaks for this seat.
                        h.conn = conn;
                        h.dropped_at = None;
                        let (player, session) = (h.player, h.session);
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
                    h.outbox = None;
                    h.dropped_at = Some(now);
                    self.record(ReplayInput::Dropped {
                        player,
                        dropped: true,
                    });
                    self.sim.mark_dropped(player, true);
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
        if self.sim.phase != Phase::Lobby {
            return Err(RejectCode::MatchFull);
        }
        // A human takes a bot's seat when the lobby is full (legacy: the newest bot yields).
        if self.sim.players().len() >= rh_sim::constants::MAX_PLAYERS {
            if let Some(bot) = self
                .sim
                .players()
                .iter()
                .rev()
                .find(|p| p.bot)
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
        self.humans.push(HumanSeat {
            player,
            conn,
            fence,
            profile,
            session,
            outbox: Some(outbox),
            dropped_at: None,
            ack_input: 0,
        });
        self.fill_bots();
        let _ = self.reports.send(RoomReport::Phase {
            match_id: self.id,
            phase: self.sim.phase,
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
            }
            // Leaving a run one still stands in is MIA: the sim resolves it now and its result is reported with the next
            // step's events; the director holds the profile until it is written.
            let result_pending = self.sim.phase == Phase::Active
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
            && self.sim.phase != Phase::Ended
            && (self.had_human || now.duration_since(self.opened_at) >= UNCLAIMED_TIMEOUT)
        {
            // Nobody left to play for: a lobby closes; a run's remaining players are all bots or gone. A room nobody has
            // joined yet waits for its first player (its admission may be acquiring a durable lease off the tick).
            return self.close();
        }
        let steps = self.pacer.due(now);
        if steps == 0 {
            return true;
        }
        let mut all_events: Vec<Event> = Vec::new();
        for _ in 0..steps {
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
            let ev = self.sim.step();
            let us = t.elapsed().as_micros().min(u32::MAX as u128) as u32;
            if let Some(r) = self.recorder.as_mut() {
                r.stepped(&self.sim);
            }
            if self.step_us.len() < 72_000 {
                self.step_us.push(us);
            }
            self.last_events = ev.clone();
            all_events.extend(ev);
        }
        self.clock
            .store(self.sim.server_time.to_bits(), Ordering::Relaxed);
        self.publish(&all_events);
        for e in &all_events {
            if let Event::Resolved { id, result, bot } = e {
                let profile = result.profile.clone();
                let fence = if *bot {
                    None
                } else {
                    self.fences.iter().find(|(p, _)| p == id).map(|(_, f)| *f)
                };
                let _ = self.reports.send(RoomReport::Result {
                    match_id: self.id,
                    profile,
                    bot: *bot,
                    fence,
                    result: result.clone(),
                });
            }
        }
        if self.sim.phase != self.reported_phase {
            // Every phase change reaches the director (a lobby that closed into a run must stop receiving joins).
            self.reported_phase = self.sim.phase;
            let _ = self.reports.send(RoomReport::Phase {
                match_id: self.id,
                phase: self.sim.phase,
                humans: self.humans_present(),
            });
        }
        if self.sim.phase == Phase::Ended && self.ended_at.is_none() {
            self.ended_at = Some(now);
        }
        if let Some(t) = self.ended_at {
            if now.duration_since(t) >= self.linger {
                return self.close();
            }
        }
        true
    }

    fn publish(&mut self, events: &[Event]) {
        for h in &self.humans {
            let Some(out) = &h.outbox else { continue };
            let obs = rh_sim::observe(&self.sim, h.player, events);
            let mut important: Vec<WireEvent> = wire::important(events, &obs);
            for e in events {
                if let Event::Resolved { id, result, .. } = e {
                    if *id == h.player {
                        important.push(WireEvent::Result(wire::result(result)));
                    }
                }
            }
            if !important.is_empty() {
                let f = ServerMsg::Events {
                    tick: self.sim.tick,
                    events: important,
                }
                .encode();
                self.bytes_out += f.len() as u64;
                out.important(f);
            }
            // Fx are filtered per viewer too: only what this player can see (a swing behind a wall is not sent).
            let fx = wire::fx_seen(&obs);
            if !fx.is_empty() {
                let f = ServerMsg::Fx {
                    tick: self.sim.tick,
                    fx,
                }
                .encode();
                self.bytes_out += f.len() as u64;
                out.fx(f);
            }
            let snap = wire::snapshot(&obs, h.ack_input).encode();
            self.bytes_out += snap.len() as u64;
            out.snapshot(snap);
        }
    }

    fn close(&mut self) -> bool {
        for h in &self.humans {
            if let Some(o) = &h.outbox {
                o.close(RejectCode::Kicked);
            }
            let _ = self.reports.send(RoomReport::Left {
                profile: h.profile.clone(),
                fence: h.fence,
                result_pending: false,
            });
        }
        self.humans.clear();
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
        let mut v = self.step_us.clone();
        v.sort_unstable();
        let q = |p: f64| {
            if v.is_empty() {
                0
            } else {
                v[((v.len() - 1) as f64 * p) as usize] as u64
            }
        };
        RoomStats {
            ticks: v.len() as u64,
            step_us_p50: q(0.5),
            step_us_p99: q(0.99),
            step_us_max: v.last().copied().unwrap_or(0) as u64,
            late_wakes: self.pacer.late_wakes,
            dropped_steps: self.pacer.dropped,
            bytes_out: self.bytes_out,
            fx_dropped: 0,
            snapshots_skipped: 0,
        }
    }
}

/// The room's task: commands in arrival order between steps; one wake per grid slot.
pub async fn run_room(mut room: Room, mut rx: mpsc::Receiver<RoomCmd>) {
    loop {
        let deadline = room.next_deadline();
        tokio::select! {
            cmd = rx.recv() => match cmd {
                Some(cmd) => room.handle(cmd, Instant::now()),
                None => { room.close(); return; }
            },
            _ = tokio::time::sleep_until(deadline) => {
                if !room.wake(Instant::now()) { return; }
            }
        }
    }
}
