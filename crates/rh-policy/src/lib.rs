//! The policy contract (docs/CONTRACTS.md C-POLICY; docs/adr/0005-policy-seam.md).
//!
//! A policy sees ONLY the immutable per-player [`Observation`] (what a human client is sent: no hidden state, no RNG, no
//! privileged diagnostics) and proposes [`RawCommand`]s. Proposals go through the same validation, order budget and input
//! queue as a human's ([`drive_seats`] calls `rh_sim::validate` and `Sim::submit`), so no policy gets extra actions per
//! simulated second. Each policy declares its decision cadence in ticks; the cadence is identical live and headless.
//!
//! Faults never stall a match: a policy that panics, proposes garbage or misses its deadline is replaced by its fallback
//! for the rest of the match (and the fault is reported). Batching or running a model elsewhere belongs OUTSIDE the
//! deterministic rules, behind [`AsyncSeat`]; no model runtime is part of this crate (Stage 1 scope: architecture only).

pub mod scripted;

use rh_sim::{
    observe_events_into, observe_into, validate, Event, Observation, PlayerId, RawCommand,
    SeenEvent, Sim,
};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Version of this contract (observation + command shapes + cadence rules). A policy built for another major version
/// must not be attached.
pub const POLICY_CONTRACT_VERSION: u16 = 1;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PolicySpec {
    pub name: String,
    pub version: String,
    pub contract: u16,
    pub observation_version: u16,
    /// Decide every N ticks (N >= 1). A human-like bot may think every few ticks; the cadence is part of the policy.
    pub decision_interval_ticks: u32,
}

pub trait Policy: Send {
    fn spec(&self) -> PolicySpec;
    /// Called at the start of every match (independent environment resets). `seed` is the policy's OWN randomness (never a
    /// match secret).
    fn reset(&mut self, seed: u64, me: PlayerId);
    /// May keep memory of earlier observations; must not depend on anything else about the match.
    fn decide(&mut self, obs: &Observation) -> Vec<RawCommand>;
    /// [`Policy::decide`] into a caller-owned buffer (cleared by the caller; the buffer keeps its capacity, so a policy that
    /// overrides this allocates nothing per decision). The default wraps `decide`, so a policy written before this existed
    /// is unchanged; a policy that overrides it must propose the same commands as its `decide`.
    fn decide_into(&mut self, obs: &Observation, out: &mut Vec<RawCommand>) {
        out.extend(self.decide(obs));
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Fault {
    Panicked,
    /// The inline call took longer than its wall-clock budget (live seats only; reported, then the fallback takes over).
    OverBudget {
        ms: f64,
    },
    /// An async decision arrived after its deadline tick.
    Late {
        ticks: u32,
    },
    IncompatibleContract {
        contract: u16,
    },
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SeatStats {
    pub decisions: u64,
    pub proposed: u64,
    pub accepted: u64,
    pub rejected: u64,
    pub fallback_decisions: u64,
}

/// One policy-driven player. Holds the policy, its fallback and the cadence.
pub struct Seat {
    pub player: PlayerId,
    policy: Box<dyn Policy>,
    fallback: Box<dyn Policy>,
    pub fault: Option<Fault>,
    next_tick: u32,
    interval: u32,
    /// Live seats set a wall-clock budget per inline decision; headless leaves it None (deterministic).
    pub budget: Option<Duration>,
    pub stats: SeatStats,
    /// Reused every decision tick (never read between ticks): the seat's observation and its proposal buffer.
    obs: Observation,
    cmds: Vec<RawCommand>,
    /// What this seat could perceive of the steps since its last decision, each step judged against that step's own line of
    /// sight; at most [`MAX_PENDING_EVENTS`] (the newest). Prepended to the next observation's events, then emptied.
    pending: Vec<SeenEvent>,
}

/// The most events a seat holds between two decisions; past it the OLDEST are dropped (a policy that decides every few
/// ticks never gets near it: a step has a handful of events).
pub const MAX_PENDING_EVENTS: usize = 256;

impl Seat {
    pub fn new(
        player: PlayerId,
        mut policy: Box<dyn Policy>,
        mut fallback: Box<dyn Policy>,
        seed: u64,
    ) -> Self {
        let spec = policy.spec();
        let interval = spec.decision_interval_ticks.max(1);
        policy.reset(seed, player);
        fallback.reset(seed ^ 0x9e37_79b9_7f4a_7c15, player);
        let fault =
            (spec.contract != POLICY_CONTRACT_VERSION).then_some(Fault::IncompatibleContract {
                contract: spec.contract,
            });
        Self {
            player,
            policy,
            fallback,
            fault,
            next_tick: 0,
            interval,
            budget: None,
            stats: SeatStats::default(),
            obs: Observation::default(),
            cmds: Vec::new(),
            pending: Vec::new(),
        }
    }

    /// Whether this seat decides on `tick`. A seat that does not want a tick is not shown an observation for it (the
    /// observation is not even built), so a policy sees exactly its decision ticks.
    pub fn wants(&self, tick: u32) -> bool {
        tick >= self.next_tick
    }

    /// The commands this seat proposes on `obs.tick` (empty when it is not due).
    pub fn decide(&mut self, obs: &Observation) -> Vec<RawCommand> {
        let mut out = Vec::new();
        self.decide_into(obs, &mut out);
        out
    }

    /// [`Seat::decide`] appending to `out`.
    pub fn decide_into(&mut self, obs: &Observation, out: &mut Vec<RawCommand>) {
        if !self.wants(obs.tick) {
            return;
        }
        self.next_tick = obs.tick + self.interval;
        self.stats.decisions += 1;
        let base = out.len();
        if self.fault.is_some() {
            self.stats.fallback_decisions += 1;
            self.fallback.decide_into(obs, out);
            return;
        }
        // The seat's wall-clock budget is a live-only fault detector, never an input to a decision.
        #[allow(clippy::disallowed_methods)]
        let started = Instant::now();
        let ran = catch_unwind(AssertUnwindSafe(|| self.policy.decide_into(obs, out)));
        match ran {
            Err(_) => {
                // Whatever the policy had proposed before it failed is discarded with it.
                out.truncate(base);
                self.fault = Some(Fault::Panicked);
                self.stats.fallback_decisions += 1;
                self.fallback.decide_into(obs, out);
            }
            Ok(()) => {
                if let Some(b) = self.budget {
                    let el = started.elapsed();
                    if el > b {
                        self.fault = Some(Fault::OverBudget {
                            ms: el.as_secs_f64() * 1000.0,
                        });
                    }
                }
            }
        }
    }
}

/// Feeds every seat that is due its observation of the last step and submits what it proposes through the ONLY input path
/// (`validate` + `Sim::submit`). The live room and the headless runner both call this, so a policy behaves identically
/// in both (tested: crates/rh-server/tests/equivalence.rs).
///
/// Event delivery rule (docs/CONTRACTS.md C-POLICY): a seat is observed (an observation is built) only on its decision
/// ticks. The events of the steps in between are not lost: after each such step the seat is told what it could perceive of
/// that step, judged against that step's own line of sight like a human's, and holds the newest [`MAX_PENDING_EVENTS`] of
/// them; the next decision's observation carries them first, in step order, then the events of the step just before it.
/// A policy therefore sees every event it could perceive, whatever its decision interval.
pub fn drive_seats(sim: &mut Sim, seats: &mut [Seat], last_events: &[Event]) {
    drive_seats_with(sim, seats, last_events, |_, _| {});
}

/// [`drive_seats`], reporting every command that passed validation and was SUBMITTED (accepted or refused by the order
/// budget: a refusal still moves the budget's refill state, so a replay must re-submit it). The one implementation both
/// runners use.
pub fn drive_seats_with(
    sim: &mut Sim,
    seats: &mut [Seat],
    last_events: &[Event],
    mut submitted: impl FnMut(PlayerId, rh_sim::Command),
) {
    for seat in seats.iter_mut() {
        if !sim.player(seat.player).is_some_and(|p| p.standing()) {
            continue;
        }
        if !seat.wants(sim.tick()) {
            // Not a decision tick: no observation, only what this step's events tell the seat.
            if !last_events.is_empty() {
                observe_events_into(sim, seat.player, last_events, &mut seat.pending);
                let over = seat.pending.len().saturating_sub(MAX_PENDING_EVENTS);
                seat.pending.drain(..over);
            }
            continue;
        }
        // The seat's own buffers, moved out for the call (a move of a few words, no allocation).
        let mut obs = std::mem::take(&mut seat.obs);
        let mut cmds = std::mem::take(&mut seat.cmds);
        observe_into(sim, seat.player, last_events, &mut obs);
        if !seat.pending.is_empty() {
            seat.pending.append(&mut obs.events);
            std::mem::swap(&mut seat.pending, &mut obs.events);
            let over = obs.events.len().saturating_sub(MAX_PENDING_EVENTS);
            obs.events.drain(..over);
        }
        cmds.clear();
        seat.decide_into(&obs, &mut cmds);
        for raw in cmds.drain(..) {
            seat.stats.proposed += 1;
            let Ok(c) = validate(raw) else {
                seat.stats.rejected += 1;
                continue;
            };
            submitted(seat.player, c);
            match sim.submit(seat.player, c) {
                Ok(()) => seat.stats.accepted += 1,
                Err(_) => seat.stats.rejected += 1,
            }
        }
        seat.obs = obs;
        seat.cmds = cmds;
    }
}

pub fn submit_all(sim: &mut Sim, player: PlayerId, cmds: Vec<RawCommand>, stats: &mut SeatStats) {
    for raw in cmds {
        stats.proposed += 1;
        match validate(raw).and_then(|c| sim.submit(player, c)) {
            Ok(()) => stats.accepted += 1,
            Err(_) => stats.rejected += 1,
        }
    }
}

/// A seat whose policy runs on its own thread (for policies too slow to call inside the tick: a future model server or
/// batched inference lives behind this). A decision requested at tick T must arrive by tick T + `deadline_ticks`;
/// otherwise the fallback decides that turn and the late answer is discarded. Not deterministic by nature (it depends on
/// wall time): live use only; the replay records the commands actually applied, so a recorded match still replays exactly.
pub struct AsyncSeat {
    pub player: PlayerId,
    tx: mpsc::Sender<(u32, Observation)>,
    rx: mpsc::Receiver<(u32, Vec<RawCommand>)>,
    fallback: Box<dyn Policy>,
    pending: Option<u32>,
    deadline_ticks: u32,
    interval: u32,
    next_tick: u32,
    pub late: u64,
    pub stats: SeatStats,
}

impl AsyncSeat {
    pub fn spawn(
        player: PlayerId,
        mut policy: Box<dyn Policy>,
        mut fallback: Box<dyn Policy>,
        seed: u64,
        deadline_ticks: u32,
    ) -> Self {
        let interval = policy.spec().decision_interval_ticks.max(1);
        policy.reset(seed, player);
        fallback.reset(seed ^ 1, player);
        let (tx, req_rx) = mpsc::channel::<(u32, Observation)>();
        let (res_tx, rx) = mpsc::channel::<(u32, Vec<RawCommand>)>();
        std::thread::spawn(move || {
            while let Ok((tick, obs)) = req_rx.recv() {
                let cmds =
                    catch_unwind(AssertUnwindSafe(|| policy.decide(&obs))).unwrap_or_default();
                if res_tx.send((tick, cmds)).is_err() {
                    break;
                }
            }
        });
        Self {
            player,
            tx,
            rx,
            fallback,
            pending: None,
            deadline_ticks,
            interval,
            next_tick: 0,
            late: 0,
            stats: SeatStats::default(),
        }
    }

    /// Called once per tick with the current observation; returns the commands to submit this tick.
    pub fn poll(&mut self, obs: &Observation) -> Vec<RawCommand> {
        let mut out = Vec::new();
        while let Ok((asked, cmds)) = self.rx.try_recv() {
            if Some(asked) == self.pending {
                self.pending = None;
                out = cmds;
            } else {
                self.late += 1;
            }
        }
        if let Some(asked) = self.pending {
            if obs.tick > asked + self.deadline_ticks {
                self.pending = None;
                self.late += 1;
                self.stats.fallback_decisions += 1;
                out = self.fallback.decide(obs);
            }
        }
        if self.pending.is_none() && obs.tick >= self.next_tick {
            self.next_tick = obs.tick + self.interval;
            self.stats.decisions += 1;
            if self.tx.send((obs.tick, obs.clone())).is_ok() {
                self.pending = Some(obs.tick);
            }
        }
        out
    }
}
