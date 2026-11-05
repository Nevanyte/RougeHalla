//! The policy contract (docs/CONTRACTS.md C-POLICY; docs/adr/0005-policy-seam.md).
//!
//! A policy sees ONLY the immutable per-player [`Observation`] (what a human client is sent: no hidden state, no RNG, no
//! privileged diagnostics) and proposes [`PublicCommand`]s. Proposals go through the same validation, order budget and input
//! queue as a human's ([`drive_seats`] calls `rh_sim::validate` and `Sim::submit`), so no policy gets extra actions per
//! simulated second. Each policy declares its decision cadence in ticks; the cadence is identical live and headless.
//!
//! Faults never stall a match: a policy that panics, proposes garbage or misses its deadline is replaced by its fallback
//! for the rest of the match (and the fault is reported). Batching or running a model elsewhere belongs OUTSIDE the
//! deterministic rules, behind [`AsyncSeat`]; no model runtime is part of this crate (Stage 1 scope: architecture only).

pub mod scripted;

use rh_sim::content::content_hash;
use rh_sim::{
    observe_events_into, observe_events_into_cached, Arena, Event, ItemObserver, Observation,
    OfferError, PlayerId, PublicCommand, SeenEvent, SightCache, Sim, OBSERVATION_VERSION,
};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

/// Version of this contract (observation + command shapes + cadence rules). A policy built for another major version
/// must not be attached.
///
/// Version 2: `Policy::reset` takes a [`MatchStart`] (the public match context) instead of `(seed, me)`; `Seat::new` and
/// `AsyncSeat::spawn` take the same [`MatchStart`] and fault on a contract or observation-version mismatch.
/// Version 3 proposals use observer-issued pickup handles.
pub const POLICY_CONTRACT_VERSION: u16 = 3;

/// Everything a policy may know about a match before its first observation, all of it public static data (the map
/// and spawn points), never match state. Never a [`rh_sim::Secrets`] value and never the sim itself (C-OBS, C-RNG, C-POLICY).
#[derive(Clone, Debug)]
pub struct MatchStart {
    /// The player this policy plays.
    pub me: PlayerId,
    /// The policy's OWN randomness seed (never a match secret).
    pub seed: u64,
    /// The static map and spawn points (public data; shared, never mutated).
    pub arena: Arc<Arena>,
    /// Identity of the rules the sim runs under ([`rh_sim::content_hash`]).
    pub content_hash: u64,
    /// The observation shape the seat will deliver ([`rh_sim::OBSERVATION_VERSION`]).
    pub observation_version: u16,
    /// Milliseconds per simulation tick.
    pub tick_ms: f64,
}

impl MatchStart {
    /// The context of a match running in `sim`, for the policy of `me` with its own `seed`. Reads only public statics.
    pub fn of(sim: &Sim, me: PlayerId, seed: u64) -> Self {
        Self {
            me,
            seed,
            arena: Arc::clone(sim.shared_arena()),
            content_hash: {
                // The rules of a build never change: fold the registry once per process.
                static HASH: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
                *HASH.get_or_init(content_hash)
            },
            observation_version: OBSERVATION_VERSION,
            tick_ms: rh_sim::constants::TICK_MS,
        }
    }

    /// The same context for the fallback policy: its randomness is decorrelated from the policy's (`seed` is already mixed by the caller).
    fn with_seed(&self, seed: u64) -> Self {
        Self {
            seed,
            ..self.clone()
        }
    }
}

/// Why a policy cannot be attached to a match, if it cannot (ADR 0005: incompatible policies are refused at attach).
fn attach_fault(spec: &PolicySpec, m: &MatchStart) -> Option<Fault> {
    if spec.contract != POLICY_CONTRACT_VERSION {
        Some(Fault::IncompatibleContract {
            contract: spec.contract,
        })
    } else if spec.observation_version != m.observation_version {
        Some(Fault::IncompatibleObservation {
            version: spec.observation_version,
        })
    } else {
        None
    }
}

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
    /// Called at the start of every match (independent environment resets) with the match's public context. `m.seed` is
    /// the policy's OWN randomness (never a match secret).
    fn reset(&mut self, m: &MatchStart);
    /// May keep memory of earlier observations; must not depend on anything else about the match.
    fn decide(&mut self, obs: &Observation) -> Vec<PublicCommand>;
    /// [`Policy::decide`] into a caller-owned buffer (cleared by the caller; the buffer keeps its capacity, so a policy that
    /// overrides this allocates nothing per decision). The default wraps `decide`, so a policy written before this existed
    /// is unchanged; a policy that overrides it must propose the same commands as its `decide`.
    fn decide_into(&mut self, obs: &Observation, out: &mut Vec<PublicCommand>) {
        out.extend(self.decide(obs));
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Fault {
    ItemObservation(OfferError),
    WorkerStopped,
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
    /// The policy was built for another [`rh_sim::OBSERVATION_VERSION`] than the one the seat delivers.
    IncompatibleObservation {
        version: u16,
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
    policy: Box<dyn Policy>,
    fallback: Box<dyn Policy>,
    pub fault: Option<Fault>,
    next_tick: u32,
    interval: u32,
    /// Live seats set a wall-clock budget per inline decision; headless leaves it None (deterministic).
    pub budget: Option<Duration>,
    pub stats: SeatStats,
    /// Reused every decision tick (never read between ticks): the seat's observation and its proposal buffer.
    observer: ItemObserver,
    obs: Observation,
    cmds: Vec<PublicCommand>,
    /// What this seat could perceive of the steps since its last decision, each step judged against that step's own line of
    /// sight; at most [`MAX_PENDING_EVENTS`] (the newest). Prepended to the next observation's events, then emptied.
    pending: Vec<SeenEvent>,
}

/// The most events a seat holds between two decisions; past it the OLDEST are dropped (a policy that decides every few
/// ticks never gets near it: a step has a handful of events).
pub const MAX_PENDING_EVENTS: usize = 256;

impl Seat {
    /// A seat for `m.me`. A policy whose contract or observation version does not match is attached already faulted: its
    /// fallback plays the whole match.
    pub fn new(m: &MatchStart, mut policy: Box<dyn Policy>, mut fallback: Box<dyn Policy>) -> Self {
        let spec = policy.spec();
        let interval = spec.decision_interval_ticks.max(1);
        let fault = attach_fault(&spec, m);
        if fault.is_none() {
            policy.reset(m);
        }
        fallback.reset(&m.with_seed(m.seed ^ 0x9e37_79b9_7f4a_7c15));
        Self {
            policy,
            fallback,
            fault,
            next_tick: 0,
            interval,
            budget: None,
            stats: SeatStats::default(),
            observer: ItemObserver::new(m.me),
            obs: Observation::default(),
            cmds: Vec::new(),
            pending: Vec::new(),
        }
    }

    pub fn player(&self) -> PlayerId {
        self.observer.viewer()
    }

    /// Whether this seat decides on `tick`. A seat that does not want a tick is not shown an observation for it (the
    /// observation is not even built), so a policy sees exactly its decision ticks.
    pub fn wants(&self, tick: u32) -> bool {
        tick >= self.next_tick
    }

    /// The commands this seat proposes on `obs.tick` (empty when it is not due).
    pub fn decide(&mut self, obs: &Observation) -> Vec<PublicCommand> {
        let mut out = Vec::new();
        self.decide_into(obs, &mut out);
        out
    }

    /// [`Seat::decide`] appending to `out`.
    pub fn decide_into(&mut self, obs: &Observation, out: &mut Vec<PublicCommand>) {
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
    drive_inner(sim, seats, last_events, None, |_, _| {});
}

/// [`drive_seats`], reporting every command that passed validation and was SUBMITTED (accepted or refused by the order
/// budget: a refusal still moves the budget's refill state, so a replay must re-submit it). The one implementation both
/// runners use.
///
/// `sight` is the runner's line-of-sight memo (one per room or match, outside the sim: see [`rh_sim::SightCache`]); the
/// observations the seats get are exactly the ones [`drive_seats`] gives.
pub fn drive_seats_with(
    sim: &mut Sim,
    seats: &mut [Seat],
    last_events: &[Event],
    sight: &mut SightCache,
    submitted: impl FnMut(PlayerId, rh_sim::Command),
) {
    drive_inner(sim, seats, last_events, Some(sight), submitted);
}

fn drive_inner(
    sim: &mut Sim,
    seats: &mut [Seat],
    last_events: &[Event],
    mut sight: Option<&mut SightCache>,
    mut submitted: impl FnMut(PlayerId, rh_sim::Command),
) {
    for seat in seats.iter_mut() {
        if !sim.player(seat.player()).is_some_and(|p| p.standing()) {
            continue;
        }
        if !seat.wants(sim.tick()) {
            // Not a decision tick: no observation, only what this step's events tell the seat.
            if !last_events.is_empty() {
                match sight.as_deref_mut() {
                    Some(c) => observe_events_into_cached(
                        sim,
                        seat.player(),
                        last_events,
                        &mut seat.pending,
                        c,
                    ),
                    None => observe_events_into(sim, seat.player(), last_events, &mut seat.pending),
                }
                let over = seat.pending.len().saturating_sub(MAX_PENDING_EVENTS);
                seat.pending.drain(..over);
            }
            continue;
        }
        // The seat's own buffers, moved out for the call (a move of a few words, no allocation).
        let mut obs = std::mem::take(&mut seat.obs);
        let mut cmds = std::mem::take(&mut seat.cmds);
        if let Err(err) =
            seat.observer
                .observe_into(sim, last_events, &mut obs, sight.as_deref_mut())
        {
            seat.fault = Some(Fault::ItemObservation(err));
            seat.obs = obs;
            seat.cmds = cmds;
            continue;
        }
        prepend_pending(&mut seat.pending, &mut obs);
        cmds.clear();
        seat.decide_into(&obs, &mut cmds);
        submit_all(sim, &seat.observer, &cmds, &mut seat.stats, &mut submitted);
        seat.obs = obs;
        seat.cmds = cmds;
    }
}

fn prepend_pending(pending: &mut Vec<SeenEvent>, obs: &mut Observation) {
    if !pending.is_empty() {
        pending.append(&mut obs.events);
        std::mem::swap(pending, &mut obs.events);
        let over = obs.events.len().saturating_sub(MAX_PENDING_EVENTS);
        obs.events.drain(..over);
    }
}

/// Resolve each proposal against the owner's delivered offer, record every validated attempt, and
/// run the normal sim intake even for a missing pickup or an order that exhausts the budget.
pub fn submit_all(
    sim: &mut Sim,
    observer: &ItemObserver,
    cmds: &[PublicCommand],
    stats: &mut SeatStats,
    mut submitted: impl FnMut(PlayerId, rh_sim::Command),
) {
    let player = observer.viewer();
    for &proposal in cmds {
        stats.proposed += 1;
        let result = observer.resolve(sim, proposal).and_then(|command| {
            submitted(player, command);
            sim.submit(player, command)
        });
        match result {
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
    observer: ItemObserver,
    obs: Observation,
    seen: Vec<SeenEvent>,
    tx: mpsc::Sender<(u32, Observation)>,
    rx: mpsc::Receiver<(u32, Option<Vec<PublicCommand>>)>,
    fallback: Box<dyn Policy>,
    pending: Option<u32>,
    deadline_ticks: u32,
    interval: u32,
    next_tick: u32,
    pub late: u64,
    pub stats: SeatStats,
    /// Set at spawn when the policy cannot be attached (see [`Seat::new`]); the fallback then decides every turn and no
    /// thread is started.
    pub fault: Option<Fault>,
}

impl AsyncSeat {
    pub fn spawn(
        m: &MatchStart,
        mut policy: Box<dyn Policy>,
        mut fallback: Box<dyn Policy>,
        deadline_ticks: u32,
    ) -> Self {
        let spec = policy.spec();
        let interval = spec.decision_interval_ticks.max(1);
        let fault = attach_fault(&spec, m);
        if fault.is_none() {
            policy.reset(m);
        }
        fallback.reset(&m.with_seed(m.seed ^ 1));
        let (tx, req_rx) = mpsc::channel::<(u32, Observation)>();
        let (res_tx, rx) = mpsc::channel::<(u32, Option<Vec<PublicCommand>>)>();
        if fault.is_none() {
            std::thread::spawn(move || {
                while let Ok((tick, obs)) = req_rx.recv() {
                    let cmds = catch_unwind(AssertUnwindSafe(|| policy.decide(&obs))).ok();
                    if res_tx.send((tick, cmds)).is_err() {
                        break;
                    }
                }
            });
        }
        Self {
            observer: ItemObserver::new(m.me),
            obs: Observation::default(),
            seen: Vec::new(),
            tx,
            rx,
            fallback,
            pending: None,
            deadline_ticks,
            interval,
            next_tick: 0,
            late: 0,
            stats: SeatStats::default(),
            fault,
        }
    }

    pub fn player(&self) -> PlayerId {
        self.observer.viewer()
    }

    /// Poll the worker once per tick. Only an actual request or fallback gets an observation and
    /// an offer; completed proposals resolve against this same seat, including delayed clicks.
    pub fn poll(
        &mut self,
        sim: &mut Sim,
        events: &[Event],
        submitted: impl FnMut(PlayerId, rh_sim::Command),
    ) -> Result<(), OfferError> {
        let tick = sim.tick();
        let mut cmds = Vec::new();
        let expired = self
            .pending
            .filter(|asked| tick > asked.saturating_add(self.deadline_ticks));
        if expired.is_some() {
            self.pending = None;
            self.late += 1;
        }
        let mut panicked = false;
        while let Ok((asked, answer)) = self.rx.try_recv() {
            if Some(asked) == self.pending {
                self.pending = None;
                if let Some(proposals) = answer {
                    cmds = proposals;
                } else {
                    self.fault = Some(Fault::Panicked);
                    panicked = true;
                }
            } else if Some(asked) != expired {
                self.late += 1;
            }
        }
        let fallback = expired.is_some() || panicked;
        let due = tick >= self.next_tick && self.pending.is_none();
        if due || fallback {
            let offer = self
                .observer
                .prepare_into(sim, events, &mut self.obs, None)?;
            prepend_pending(&mut self.seen, &mut self.obs);
            if due {
                self.stats.decisions += 1;
                self.next_tick = tick.saturating_add(self.interval);
                if self.fault.is_none() {
                    if self.tx.send((tick, self.obs.clone())).is_ok() {
                        self.pending = Some(tick);
                    } else {
                        self.fault = Some(Fault::WorkerStopped);
                    }
                }
            }
            if fallback || self.fault.is_some() {
                self.stats.fallback_decisions += 1;
                cmds = self.fallback.decide(&self.obs);
            }
            offer.commit(); // Delivered to the worker, fallback, or both.
        } else if !events.is_empty() {
            observe_events_into(sim, self.player(), events, &mut self.seen);
            let over = self.seen.len().saturating_sub(MAX_PENDING_EVENTS);
            self.seen.drain(..over);
        }
        submit_all(sim, &self.observer, &cmds, &mut self.stats, submitted);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scripted::{Brawler, Idle};
    use rh_sim::{FactionId, Placement, Secrets, SimConfig, Vec2};
    use std::sync::Mutex;

    type Seen = Arc<Mutex<Vec<(PlayerId, u64, usize, u64, u16, f64)>>>;

    fn sim() -> Sim {
        let place = Placement {
            profile: "a".into(),
            faction: FactionId::ALL[0],
            bot: true,
            at: Vec2::new(2000.0, 2000.0),
            hp: None,
            weapon0: None,
            weapon1: None,
        };
        Sim::reset_active(
            SimConfig::default(),
            rh_sim::arenas::practice_arena(),
            Secrets::from_seed(1),
            &[place],
        )
    }

    /// A policy that records what it was told at reset and declares any versions.
    struct Probe {
        contract: u16,
        observation_version: u16,
        seen: Seen,
    }
    impl Policy for Probe {
        fn spec(&self) -> PolicySpec {
            PolicySpec {
                name: "probe".into(),
                version: "1".into(),
                contract: self.contract,
                observation_version: self.observation_version,
                decision_interval_ticks: 1,
            }
        }
        fn reset(&mut self, m: &MatchStart) {
            self.seen.lock().unwrap().push((
                m.me,
                m.seed,
                m.arena.spawns.len(),
                m.content_hash,
                m.observation_version,
                m.tick_ms,
            ));
        }
        fn decide(&mut self, _: &Observation) -> Vec<PublicCommand> {
            Vec::new()
        }
    }

    fn probe(contract: u16, observation_version: u16) -> (Probe, Seen) {
        let seen = Seen::default();
        (
            Probe {
                contract,
                observation_version,
                seen: Arc::clone(&seen),
            },
            seen,
        )
    }

    #[test]
    fn reset_receives_the_public_match_context() {
        let sim = sim();
        let me = sim.players()[0].id;
        let m = MatchStart::of(&sim, me, 77);
        let (p, seen) = probe(POLICY_CONTRACT_VERSION, OBSERVATION_VERSION);
        let seat = Seat::new(&m, Box::new(p), Box::new(Idle));
        assert!(seat.fault.is_none());
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(
            seen[0],
            (
                me,
                77,
                sim.arena().spawns.len(),
                rh_sim::content::content_hash(),
                OBSERVATION_VERSION,
                rh_sim::constants::TICK_MS
            )
        );
        assert!(Arc::ptr_eq(&m.arena, sim.shared_arena()));
    }

    #[test]
    fn a_seat_refuses_a_policy_of_another_contract_or_observation_version() {
        let sim = sim();
        let m = MatchStart::of(&sim, sim.players()[0].id, 1);
        let (p, _) = probe(POLICY_CONTRACT_VERSION + 1, OBSERVATION_VERSION);
        let seat = Seat::new(&m, Box::new(p), Box::new(Idle));
        assert_eq!(
            seat.fault,
            Some(Fault::IncompatibleContract {
                contract: POLICY_CONTRACT_VERSION + 1
            })
        );
        let (p, _) = probe(POLICY_CONTRACT_VERSION, OBSERVATION_VERSION + 1);
        let seat = Seat::new(&m, Box::new(p), Box::new(Idle));
        assert_eq!(
            seat.fault,
            Some(Fault::IncompatibleObservation {
                version: OBSERVATION_VERSION + 1
            })
        );
        assert!(Seat::new(&m, Box::new(Brawler::new(2)), Box::new(Idle))
            .fault
            .is_none());
    }

    #[test]
    #[allow(clippy::disallowed_methods)] // Wall-clock timeout only in the test harness polling a real worker.
    fn async_worker_and_fallback_resolve_only_actually_delivered_offers() {
        struct Click {
            log: mpsc::Sender<rh_sim::PickupHandle>,
            first: bool,
            incompatible: bool,
        }
        impl Policy for Click {
            fn spec(&self) -> PolicySpec {
                PolicySpec {
                    contract: POLICY_CONTRACT_VERSION + u16::from(self.incompatible),
                    decision_interval_ticks: 25,
                    ..Idle.spec()
                }
            }
            fn reset(&mut self, _: &MatchStart) {}
            fn decide(&mut self, obs: &Observation) -> Vec<PublicCommand> {
                let handle = obs.props.iter().find(|p| p.cue.focused).unwrap().handle;
                self.log.send(handle).unwrap();
                if std::mem::take(&mut self.first) {
                    return Vec::new();
                }
                vec![PublicCommand::Pickup { handle }]
            }
        }
        for use_fallback in [true, false] {
            let position = Vec2::new(100., 272.);
            let p = Placement {
                profile: "worker".into(),
                faction: FactionId::Holy,
                bot: false,
                at: position,
                hp: None,
                weapon0: None,
                weapon1: None,
            };
            let second = Placement {
                profile: "second".into(),
                at: Vec2::new(1300., 272.),
                ..p.clone()
            };
            let mut sim = Sim::reset_active(
                SimConfig::default(),
                rh_sim::arenas::practice_arena(),
                Secrets::from_seed(3),
                &[p, second],
            );
            sim.seed_weapon_container(
                rh_sim::ContainerKind::Ground,
                Vec2::new(1300., 272.),
                &[rh_sim::WeaponId::Bow],
            )
            .unwrap();
            sim.seed_weapon_container(
                rh_sim::ContainerKind::Ground,
                position,
                &[rh_sim::WeaponId::Axe],
            )
            .unwrap();
            let (tx, rx) = mpsc::channel();
            let click = |incompatible| Click {
                log: tx.clone(),
                first: true,
                incompatible,
            };
            let me = PlayerId(1);
            let mut seat = AsyncSeat::spawn(
                &MatchStart::of(&sim, me, 3),
                Box::new(click(use_fallback)),
                Box::new(click(false)),
                100,
            );
            seat.poll(&mut sim, &[], |_, _| panic!("no first action"))
                .unwrap();
            assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap().get(), 1);
            let start = Instant::now();
            while seat.pending.is_some() {
                assert!(start.elapsed() < Duration::from_secs(2));
                std::thread::yield_now();
                seat.poll(&mut sim, &[], |_, _| panic!("no first action"))
                    .unwrap();
            }
            for _ in 1..25 {
                sim.step();
                seat.poll(&mut sim, &[], |_, _| panic!("no skipped-tick action"))
                    .unwrap();
                assert_eq!(
                    seat.observer
                        .resolve(
                            &sim,
                            PublicCommand::Pickup {
                                handle: rh_sim::PickupHandle::new(2).unwrap()
                            }
                        )
                        .unwrap(),
                    rh_sim::validate(rh_sim::RawCommand::MissingPickup).unwrap()
                );
            }
            sim.step();
            seat.poll(&mut sim, &[], |_, _| {}).unwrap();
            assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap().get(), 2);
            // Worker result delivery is asynchronous. Poll this frozen tick until the accepted answer
            // arrives, bounded so a regression cannot hang the test suite.
            let start = Instant::now();
            while seat.stats.accepted == 0 {
                assert!(start.elapsed() < Duration::from_secs(2));
                std::thread::yield_now();
                seat.poll(&mut sim, &[], |_, _| {}).unwrap();
            }
            sim.step();
            assert_eq!(
                sim.player(me).unwrap().weapon.weapon0,
                Some(rh_sim::WeaponId::Axe)
            );
        }
    }

    #[test]
    fn a_late_or_panicked_async_answer_uses_the_observed_fallback() {
        for late in [true, false] {
            let mut sim = sim();
            let m = MatchStart::of(&sim, sim.players()[0].id, 1);
            let mut seat = AsyncSeat::spawn(&m, Box::new(Idle), Box::new(Idle), 0);
            // Feed a controlled completion; no scheduling race in the deadline/panic assertions.
            let (tx, rx) = mpsc::channel();
            seat.rx = rx;
            let asked = sim.tick();
            seat.pending = Some(asked);
            seat.next_tick = asked + 100;
            if late {
                tx.send((asked, Some(vec![PublicCommand::Stop { seq: None }])))
                    .unwrap();
                sim.step();
            } else {
                tx.send((asked, None)).unwrap();
            }
            seat.poll(&mut sim, &[], |_, _| panic!("bad worker answer submitted"))
                .unwrap();
            assert_eq!(seat.stats.fallback_decisions, 1);
            assert_eq!(seat.late, u64::from(late));
            assert_eq!(seat.fault, (!late).then_some(Fault::Panicked));
        }
    }

    #[test]
    fn an_async_seat_faults_and_plays_its_fallback_on_a_mismatch() {
        let mut sim = sim();
        let m = MatchStart::of(&sim, sim.players()[0].id, 1);
        let (p, _) = probe(POLICY_CONTRACT_VERSION, OBSERVATION_VERSION + 1);
        let mut seat = AsyncSeat::spawn(&m, Box::new(p), Box::new(Idle), 3);
        assert_eq!(
            seat.fault,
            Some(Fault::IncompatibleObservation {
                version: OBSERVATION_VERSION + 1
            })
        );
        seat.poll(&mut sim, &[], |_, _| panic!("idle fallback submitted"))
            .unwrap();
        assert_eq!(seat.stats.fallback_decisions, 1);
        let ok = AsyncSeat::spawn(&m, Box::new(Brawler::new(1)), Box::new(Idle), 3);
        assert!(ok.fault.is_none());
    }
}
