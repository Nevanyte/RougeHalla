//! The policy contract (docs/CONTRACTS.md C-POLICY; docs/adr/0005-policy-seam.md).
//!
//! Live HumanBot sees only an accepted, reconstructed protocol14 frame and proposes [`PublicCommand`]s.
//! Explicit native compatibility policies retain the older [`Observation`] callback; they do not claim human-codec
//! equivalence. Neither input contains world/secret RNG or privileged diagnostics. Proposals go through the same validation, order budget and input
//! queue as a human's ([`drive_seats`] calls `rh_sim::validate` and `Sim::submit`), so no policy gets extra actions per
//! simulated second. Each policy declares its decision cadence in ticks; the cadence is identical live and headless.
//!
//! Faults never stall a match: a policy that panics, proposes garbage or misses its deadline is replaced by its fallback
//! for the rest of the match (and the fault is reported). Batching or running a model elsewhere belongs OUTSIDE the
//! deterministic rules, behind [`AsyncSeat`]; no model runtime is part of this crate (Stage 1 scope: architecture only).

pub mod bots;
pub mod delivery;
pub mod scripted;

use rh_sim::content::content_hash;
use rh_sim::{
    Arena, Event, ItemObserver, Observation, OfferError, PlayerId, PublicCommand, SeenEvent,
    SightCache, Sim, OBSERVATION_VERSION,
};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

/// Version of this contract (observation + command shapes + cadence rules). A policy built for another major version
/// must not be attached.
///
/// Version 2: `Policy::reset` takes a [`MatchStart`] (the public match context) instead of `(seed, me)`; `Seat::new` and
/// `AsyncSeat::spawn` take the same [`MatchStart`] and fault on a contract or observation-version mismatch.
/// Version 3 proposals use observer-issued pickup handles. Version 4 binds actor targeting to complete delivery.
/// Version 5 feeds temporally eligible signature effects every tick, independently of decision cadence.
/// Version 6 adds Fire Burn and canonically merged, report-local Backlash effects.
/// Version 7 adds player Frost chilled bits and the resulting attack/movement clocks.
/// Version 15 requires accepted decoded public frames for HumanBot, scoped references and transactional handoff.
/// Version 16 (protocol 16, observation 22) adds actor/self hitbox archetype ids and projectile heights (ADR0024).
/// Version 17 (protocol 16, observation 23) adds the legacy indicator facts (ADR0026): actor/self indicator flags, off-hand,
/// build marks and mark plate, windup/cancel/heal/signature-hit fx with hit kinds and crits, and the match roster.
/// Version 18 (protocol 16, observation 24) unions the Card bleed public `Hit` projection (backend, OBS 22 knowledge change)
/// with the version 17 indicator facts.
/// Explicit native compatibility policies retain their separately declared input kind.
/// Version 19 (observation 25, P-WIRE17-HUD-1): the projection gains each camp's reward and ward verdict and the owner's
/// build summary (State key 13); bots do not decide on them.
/// Version 20 (observation 26, P-WIRE17-HUD-2): the owner's build summary carries its champion panel values; bots do
/// not decide on them.
/// Version 21 (observation 27, P-WIRE17-HUD-2c): the owner's champion panel gains codes 23-27 (Fire roam speed bonus and
/// burst, hit multiplier, weapon scaling split); bots do not decide on them.
/// Version 22 (observation 28, P-WIRE17-HUD-3): the owner's inventory carries its healing-potion and wind-emblem end
/// times, the arena view the room's minimum players; bots do not decide on them.
/// Version 23 (observation 29, P-WIRE17-MAP-2): the projected quest row carries the carrier's public actor id while the
/// viewer is delivered that fighter; bots do not decide on it.
pub const POLICY_CONTRACT_VERSION: u16 = 23;

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

/// The policy's own telemetry counters, as the source BrainStats exposes them for the tournament report: the humanizer
/// block only (commands/reactions/clicks/APM). The source hunts/tactics/goals counters are not ported into the policy yet
/// (P-BOTS-1/P-BOTS-3/P-BOTS-4 remainder), so they are absent from the summary, never zeroed. Owned snapshot.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PolicyStats {
    pub commands: Vec<(String, u64)>,
    pub reactions: Vec<(String, Vec<f64>)>,
    pub target_clicks: u64,
    pub click_missed: u64,
    pub click_wrong: u64,
    pub hesitations: u64,
    pub lapses: u64,
    pub throttled: u64,
    pub superseded: u64,
    pub apm_peak: u64,
}

/// NativeCompatibility is an explicit legacy scripted-policy lane, not human-codec equivalence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InputKind {
    NativeCompatibility,
    Delivered14,
}
#[derive(Clone, Copy)]
pub enum PolicyInput<'a> {
    NativeCompatibility(&'a Observation),
    Delivered14(&'a delivery::AcceptedFrame14),
}
#[derive(Clone, Copy)]
pub enum InputPreview<'a> {
    NativeCompatibility(&'a Observation),
    Delivered14(&'a delivery::Frame14),
}
impl<'a> PolicyInput<'a> {
    fn preview(self) -> InputPreview<'a> {
        match self {
            Self::NativeCompatibility(v) => InputPreview::NativeCompatibility(v),
            Self::Delivered14(v) => InputPreview::Delivered14(v.frame()),
        }
    }
    fn tick(self) -> u32 {
        match self {
            Self::NativeCompatibility(v) => v.tick,
            Self::Delivered14(v) => v.frame().tick(),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InputRefusal {
    RequiresDelivered14,
    RequiresNativeCompatibility,
    InventoryUnavailable,
    OwnerCombatUnavailable,
    InvalidOwner,
    ClockResetRequired,
    MemoryUnavailable,
    /// The policy's own decision core refused the composed input (a native invariant, not a frame fact).
    PolicyFailed,
    /// The frame carries no source arena lifecycle group, which the policy's HUD needs (a non-source runtime).
    ArenaUnavailable,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct InputRequirements {
    pub inventory: bool,
    pub owner_combat: bool,
}
impl InputRequirements {
    fn check(self, frame: &delivery::Frame14) -> Result<(), InputRefusal> {
        if frame.owner.is_some() && frame.phase != 3 {
            if self.inventory && frame.collections.inventory.is_none() {
                return Err(InputRefusal::InventoryUnavailable);
            }
            if self.owner_combat && frame.owner_combat.is_none() {
                return Err(InputRefusal::OwnerCombatUnavailable);
            }
        }
        Ok(())
    }
}
fn check_receiver<P: Policy + ?Sized>(
    policy: &P,
    input: InputPreview<'_>,
) -> Result<(), InputRefusal> {
    if let InputPreview::Delivered14(frame) = input {
        policy.input_requirements().check(frame)?;
    }
    policy.check_input(input)
}

pub trait Policy: Send {
    fn input_requirements(&self) -> InputRequirements {
        InputRequirements::default()
    }
    fn input_kind(&self) -> InputKind {
        InputKind::NativeCompatibility
    }
    /// Immutable acceptance preflight. A refusal here must not mutate policy state or RNG.
    fn check_input(&self, input: InputPreview<'_>) -> Result<(), InputRefusal> {
        match input {
            InputPreview::NativeCompatibility(_)
                if self.input_kind() == InputKind::NativeCompatibility =>
            {
                Ok(())
            }
            _ => Err(InputRefusal::RequiresNativeCompatibility),
        }
    }
    /// Connected typed path. Old raw callbacks remain only for explicitly native compatibility policies.
    fn decide_input_into(
        &mut self,
        input: PolicyInput<'_>,
        out: &mut Vec<PublicCommand>,
    ) -> Result<(), InputRefusal> {
        check_receiver(self, input.preview())?;
        match input {
            PolicyInput::NativeCompatibility(v) => {
                self.decide_into(v, out);
                Ok(())
            }
            PolicyInput::Delivered14(_) => Err(InputRefusal::RequiresNativeCompatibility),
        }
    }
    fn spec(&self) -> PolicySpec;
    /// The policy's telemetry counters for a tournament summary (None: a policy that reports none).
    fn stats(&self) -> Option<PolicyStats> {
        None
    }
    /// Called at the start of every match (independent environment resets) with the match's public context. `m.seed` is
    /// the policy's OWN randomness (never a match secret).
    fn reset(&mut self, m: &MatchStart);
    /// The seat's run resolved (`Some`) or the match closed without a result (`None`): the policy's end-of-run summary
    /// (source `brain.end(result)`), asked at most once per seat ([`Seat::finish`]). A policy with nothing to report
    /// answers `None` (the default).
    fn finish(&mut self, _result: Option<&rh_sim::RunResult>) -> Option<PolicyFinish> {
        None
    }
    /// May keep memory of earlier observations; must not depend on anything else about the match.
    fn decide(&mut self, obs: &Observation) -> Vec<PublicCommand>;
    /// [`Policy::decide`] into a caller-owned buffer (cleared by the caller; the buffer keeps its capacity, so a policy that
    /// overrides this allocates nothing per decision). The default wraps `decide`, so a policy written before this existed
    /// is unchanged; a policy that overrides it must propose the same commands as its `decide`.
    fn decide_into(&mut self, obs: &Observation, out: &mut Vec<PublicCommand>) {
        out.extend(self.decide(obs));
    }
}

/// A policy's end-of-run summary: the choice keys its learning record carries (source `RunSummary.choices`, e.g.
/// `opener|fire|plague`), in the order the policy made them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PolicyFinish {
    pub choices: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Fault {
    Input(InputRefusal),
    Delivery(delivery::DeliveryError),
    FxProjection(rh_sim::FxError),
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
    input_kind: InputKind,
    delivery: delivery::DeliverySession,
    fallback: Box<dyn Policy>,
    pub fault: Option<Fault>,
    next_tick: u32,
    interval: u32,
    /// Live seats set a wall-clock budget per inline decision; headless leaves it None (deterministic).
    pub budget: Option<Duration>,
    pub stats: SeatStats,
    /// Reused every decision tick (never read between ticks): the seat's observation and its proposal buffer.
    observer: ItemObserver,
    fx: Option<rh_sim::FxProjector>,
    obs: Observation,
    cmds: Vec<PublicCommand>,
    /// What this seat could perceive of the steps since its last decision, each step judged against that step's own line of
    /// sight; at most [`MAX_PENDING_EVENTS`] (the newest). Prepended to the next observation's events, then emptied.
    pending: Vec<SeenEvent>,
    results: Vec<rh_protocol::WireEvent>,
    results_tick: Option<u32>,
    finished: bool,
}

/// The most events a seat holds between two decisions; past it the OLDEST are dropped (a policy that decides every few
/// ticks never gets near it: a step has a handful of events).
pub const MAX_PENDING_EVENTS: usize = 256;

impl Seat {
    /// The seat policy telemetry snapshot (source manager.brainOf(id).stats).
    pub fn stats(&self) -> Option<PolicyStats> {
        self.policy.stats()
    }

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
            input_kind: policy.input_kind(),
            delivery: delivery::DeliverySession::new(m.me),
            policy,
            fallback,
            fault,
            next_tick: 0,
            interval,
            budget: None,
            stats: SeatStats::default(),
            observer: ItemObserver::new(m.me),
            fx: None,
            obs: Observation::default(),
            cmds: Vec::new(),
            pending: Vec::new(),
            results: Vec::new(),
            results_tick: None,
            finished: false,
        }
    }

    /// The policy's end-of-run summary, asked once: a second call, a faulted seat (its fallback played; this includes a
    /// policy never attached for an incompatible contract or observation) or a policy that panics answers `None`. The fallback never reports (its choices are not the
    /// policy's).
    pub fn finish(&mut self, result: Option<&rh_sim::RunResult>) -> Option<PolicyFinish> {
        if std::mem::replace(&mut self.finished, true) {
            return None;
        }
        // A faulted seat's result was played (at least in part) by its fallback: the policy's choices are not evidence
        // for that result, so nothing reaches a learning record. This also covers a policy never attached (an
        // incompatible contract or observation).
        if self.fault.is_some() {
            return None;
        }
        catch_unwind(AssertUnwindSafe(|| self.policy.finish(result)))
            .ok()
            .flatten()
    }

    pub fn player(&self) -> PlayerId {
        self.observer.viewer()
    }

    /// Resolve one proposal against the sim now (the delay line's delivery point): `None` when it cannot be resolved
    /// (a missing pickup, a stale handle, ...), which the runner counts as a refused command.
    pub fn resolve(&self, sim: &Sim, proposal: PublicCommand) -> Option<rh_sim::Command> {
        self.observer.resolve(sim, proposal).ok()
    }

    /// Record a delayed command's delivery outcome (accepted or refused).
    pub fn note_delivery(&mut self, accepted: bool) {
        if accepted {
            self.stats.accepted += 1;
        } else {
            self.stats.rejected += 1;
        }
    }

    /// Establish a fresh presentation session BEFORE its first owned simulation step.
    /// Binding is one-time: a new simulation/session requires a new seat.
    pub fn bind_fx(&mut self, sim: &Sim) -> Result<(), rh_sim::FxError> {
        if self.fx.is_some() {
            return Err(rh_sim::FxError::AlreadyBound);
        }
        self.fx = Some(rh_sim::FxProjector::attach(sim, self.player()));
        Ok(())
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
        if self.input_kind != InputKind::NativeCompatibility {
            return;
        }
        if matches!(self.fault, Some(Fault::FxProjection(_))) {
            return;
        }
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
    fn decide_delivered_into(
        &mut self,
        frame: &delivery::AcceptedFrame14,
        out: &mut Vec<PublicCommand>,
    ) {
        let input = PolicyInput::Delivered14(frame);
        let tick = input.tick();
        if !self.wants(tick) {
            return;
        }
        self.next_tick = tick.saturating_add(self.interval);
        self.stats.decisions += 1;
        if self.fault.is_some() {
            self.stats.fallback_decisions += 1;
            self.decide_delivered_fallback_into(input, out);
            return;
        }
        let base = out.len();
        #[allow(clippy::disallowed_methods)]
        let started = Instant::now();
        let ran = catch_unwind(AssertUnwindSafe(|| {
            self.policy.decide_input_into(input, out)
        }));
        match ran {
            Ok(Ok(())) => {
                if let Some(b) = self.budget {
                    let elapsed = started.elapsed();
                    if elapsed > b {
                        self.fault = Some(Fault::OverBudget {
                            ms: elapsed.as_secs_f64() * 1000.,
                        });
                    }
                }
            }
            result => {
                out.truncate(base);
                self.fault = Some(match result {
                    Ok(Err(e)) => Fault::Input(e),
                    _ => Fault::Panicked,
                });
                self.stats.fallback_decisions += 1;
                self.decide_delivered_fallback_into(input, out);
            }
        }
    }
    /// The frame was already accepted. Refusal/panic discards this decision's proposals, not
    /// arbitrary policy memory/RNG, observer bindings or a caller's pre-existing output prefix.
    fn decide_delivered_fallback_into(
        &mut self,
        input: PolicyInput<'_>,
        out: &mut Vec<PublicCommand>,
    ) {
        let base = out.len();
        let ran = catch_unwind(AssertUnwindSafe(|| {
            self.fallback.decide_input_into(input, out)
        }));
        match ran {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                out.truncate(base);
                self.fault = Some(Fault::Input(error));
            }
            Err(_) => {
                out.truncate(base);
                self.fault = Some(Fault::Panicked);
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

/// Like [`drive_seats`] but hands every proposal back instead of submitting it, for a runner that puts the bot's commands
/// on a delay line (source BotManager: the bot's adapter sends through `deliver`, and the room applies an arrival later).
/// The proposal is resolved and submitted at delivery time by the runner (`Seat::resolve` + `Sim::submit`), so a command
/// is still validated against the state at the step that applies it. The seat stats count the proposals now; the delivery
/// outcome is recorded by the runner with [`Seat::note_delivery`].
pub fn drive_seats_queued(
    sim: &mut Sim,
    seats: &mut [Seat],
    _last_events: &[Event],
    sight: &mut SightCache,
    mut queued: impl FnMut(PlayerId, PublicCommand),
) {
    feed_seats(sim, seats);
    for seat in seats.iter_mut() {
        collect_results(
            sim.tick(),
            seat.player(),
            _last_events,
            &mut seat.results_tick,
            &mut seat.results,
        );
        if matches!(seat.fault, Some(Fault::FxProjection(_))) {
            continue;
        }
        if seat.input_kind == InputKind::NativeCompatibility
            && !sim.player(seat.player()).is_some_and(|p| {
                p.standing()
                    || (sim.phase() == rh_sim::Phase::Planning
                        && p.status == rh_sim::Status::Lobby
                        && !p.resolved)
            })
        {
            continue;
        }
        if !seat.wants(sim.tick()) {
            continue;
        }
        let mut obs = std::mem::take(&mut seat.obs);
        let mut cmds = std::mem::take(&mut seat.cmds);
        let offer =
            match seat
                .observer
                .prepare_with_seen(sim, &[], &seat.pending, &mut obs, Some(sight))
            {
                Ok(v) => v,
                Err(error) => {
                    seat.fault = Some(Fault::ItemObservation(error));
                    seat.obs = obs;
                    seat.cmds = cmds;
                    continue;
                }
            };
        let accepted = if seat.input_kind == InputKind::Delivered14 {
            let pending = match seat.delivery.prepare(
                &obs,
                offer.props_changed(),
                offer.rewards_changed(),
                &seat.results,
            ) {
                Ok(v) => v,
                Err(e) => {
                    seat.fault = Some(Fault::Delivery(e));
                    drop(offer);
                    seat.obs = obs;
                    seat.cmds = cmds;
                    continue;
                }
            };
            // Disjoint borrows: preflight policy/fallback before commit, with data only.
            let preview = InputPreview::Delivered14(&pending.frame);
            let preflight = if seat.fault.is_some() {
                check_receiver(&*seat.fallback, preview).map(|_| None)
            } else {
                match check_receiver(&*seat.policy, preview) {
                    Ok(()) => Ok(None),
                    Err(e) => check_receiver(&*seat.fallback, preview).map(|_| Some(e)),
                }
            };
            match preflight {
                Ok(Some(e)) => seat.fault = Some(Fault::Input(e)),
                Ok(None) => {}
                Err(e) => {
                    seat.fault = Some(Fault::Input(e));
                    drop(offer);
                    seat.obs = obs;
                    seat.cmds = cmds;
                    continue;
                }
            }
            offer.commit();
            Some(seat.delivery.commit(pending))
        } else {
            offer.commit();
            None
        };
        seat.pending.clear();
        seat.results.clear();
        let over = obs.events.len().saturating_sub(MAX_PENDING_EVENTS);
        obs.events.drain(..over);
        cmds.clear();
        if let Some(frame) = &accepted {
            seat.decide_delivered_into(frame, &mut cmds)
        } else {
            seat.decide_into(&obs, &mut cmds)
        }
        for &proposal in &cmds {
            seat.stats.proposed += 1;
            queued(seat.player(), proposal);
        }
        seat.obs = obs;
        seat.cmds = cmds;
    }
}

/// Canonical presentation feed. Bind each seat before its first owned step, then call after EVERY step.
/// Compatibility for an unbound seat attaches at the current tick and excludes that already completed report.
pub fn feed_seats(sim: &Sim, seats: &mut [Seat]) {
    for seat in seats {
        if matches!(seat.fault, Some(Fault::FxProjection(_))) {
            seat.pending.clear();
            continue;
        }
        let viewer = seat.player();
        let Some(fx) = seat.fx.as_mut() else {
            seat.fx = Some(rh_sim::FxProjector::attach(sim, viewer));
            continue;
        };
        match fx.feed(sim.fx_report()) {
            Ok(rh_sim::FeedStatus::Duplicate) => {}
            Ok(_) => {
                if let Err(e) = fx.append_into(sim, viewer, &mut seat.pending) {
                    seat.pending.clear();
                    seat.fault = Some(Fault::FxProjection(e));
                    continue;
                }
                let over = seat.pending.len().saturating_sub(MAX_PENDING_EVENTS);
                seat.pending.drain(..over);
            }
            Err(e) => {
                seat.pending.clear();
                seat.fault = Some(Fault::FxProjection(e));
            }
        }
    }
}

fn drive_inner(
    sim: &mut Sim,
    seats: &mut [Seat],
    _last_events: &[Event],
    mut sight: Option<&mut SightCache>,
    mut submitted: impl FnMut(PlayerId, rh_sim::Command),
) {
    feed_seats(sim, seats);
    for seat in seats.iter_mut() {
        collect_results(
            sim.tick(),
            seat.player(),
            _last_events,
            &mut seat.results_tick,
            &mut seat.results,
        );
        // A failed presentation session cannot commit actor eligibility or authorize commands.
        if matches!(seat.fault, Some(Fault::FxProjection(_))) {
            continue;
        }
        if seat.input_kind == InputKind::NativeCompatibility
            && !sim.player(seat.player()).is_some_and(|p| {
                p.standing()
                    || (sim.phase() == rh_sim::Phase::Planning
                        && p.status == rh_sim::Status::Lobby
                        && !p.resolved)
            })
        {
            continue;
        }
        if !seat.wants(sim.tick()) {
            continue;
        }
        // The seat's own buffers, moved out for the call (a move of a few words, no allocation).
        let mut obs = std::mem::take(&mut seat.obs);
        let mut cmds = std::mem::take(&mut seat.cmds);
        let offer = match seat.observer.prepare_with_seen(
            sim,
            &[],
            &seat.pending,
            &mut obs,
            sight.as_deref_mut(),
        ) {
            Ok(v) => v,
            Err(error) => {
                seat.fault = Some(Fault::ItemObservation(error));
                seat.obs = obs;
                seat.cmds = cmds;
                continue;
            }
        };
        let accepted = if seat.input_kind == InputKind::Delivered14 {
            let pending = match seat.delivery.prepare(
                &obs,
                offer.props_changed(),
                offer.rewards_changed(),
                &seat.results,
            ) {
                Ok(v) => v,
                Err(e) => {
                    seat.fault = Some(Fault::Delivery(e));
                    drop(offer);
                    seat.obs = obs;
                    seat.cmds = cmds;
                    continue;
                }
            };
            // Disjoint borrows: preflight policy/fallback before commit, with data only.
            let preview = InputPreview::Delivered14(&pending.frame);
            let preflight = if seat.fault.is_some() {
                check_receiver(&*seat.fallback, preview).map(|_| None)
            } else {
                match check_receiver(&*seat.policy, preview) {
                    Ok(()) => Ok(None),
                    Err(e) => check_receiver(&*seat.fallback, preview).map(|_| Some(e)),
                }
            };
            match preflight {
                Ok(Some(e)) => seat.fault = Some(Fault::Input(e)),
                Ok(None) => {}
                Err(e) => {
                    seat.fault = Some(Fault::Input(e));
                    drop(offer);
                    seat.obs = obs;
                    seat.cmds = cmds;
                    continue;
                }
            }
            offer.commit();
            Some(seat.delivery.commit(pending))
        } else {
            offer.commit();
            None
        };
        seat.pending.clear();
        seat.results.clear();
        let over = obs.events.len().saturating_sub(MAX_PENDING_EVENTS);
        obs.events.drain(..over);
        cmds.clear();
        if let Some(frame) = &accepted {
            seat.decide_delivered_into(frame, &mut cmds)
        } else {
            seat.decide_into(&obs, &mut cmds)
        }
        submit_all(sim, &seat.observer, &cmds, &mut seat.stats, &mut submitted);
        seat.obs = obs;
        seat.cmds = cmds;
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
#[derive(Clone, Debug, PartialEq, Eq)]
struct RequestToken {
    session: delivery::frame::SessionId,
    epoch: crate::bots::delivered::Epoch,
    sample: delivery::SampleId,
    tick: u32,
}
enum WorkerInput {
    Native(Box<Observation>),
    Delivered(delivery::AcceptedFrame14),
}
impl WorkerInput {
    fn input(&self) -> PolicyInput<'_> {
        match self {
            Self::Native(v) => PolicyInput::NativeCompatibility(v),
            Self::Delivered(v) => PolicyInput::Delivered14(v),
        }
    }
}
#[derive(Debug)]
enum WorkerFailure {
    Panicked,
    Input(InputRefusal),
}
fn collect_results(
    tick: u32,
    viewer: PlayerId,
    events: &[Event],
    last: &mut Option<u32>,
    out: &mut Vec<rh_protocol::WireEvent>,
) {
    if *last == Some(tick) {
        return;
    }
    *last = Some(tick);
    out.extend(events.iter().filter_map(|event| match event {
        Event::Resolved { id, result, .. } if *id == viewer => Some(
            rh_protocol::WireEvent::Result(delivery::projection::result(result)),
        ),
        _ => None,
    }));
}
pub struct AsyncSeat {
    input_kind: InputKind,
    requirements: InputRequirements,
    delivery: delivery::DeliverySession,
    next_request: u64,
    results: Vec<rh_protocol::WireEvent>,
    results_tick: Option<u32>,
    observer: ItemObserver,
    fx: Option<rh_sim::FxProjector>,
    obs: Observation,
    seen: Vec<SeenEvent>,
    tx: mpsc::SyncSender<(RequestToken, WorkerInput)>,
    rx: mpsc::Receiver<(RequestToken, Result<Vec<PublicCommand>, WorkerFailure>)>,
    fallback: Box<dyn Policy>,
    pending: Option<RequestToken>,
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
        let input_kind = policy.input_kind();
        let requirements = policy.input_requirements();
        let (tx, req_rx) = mpsc::sync_channel::<(RequestToken, WorkerInput)>(1);
        let (res_tx, rx) =
            mpsc::channel::<(RequestToken, Result<Vec<PublicCommand>, WorkerFailure>)>();
        if fault.is_none() {
            std::thread::spawn(move || {
                while let Ok((token, input)) = req_rx.recv() {
                    let cmds = catch_unwind(AssertUnwindSafe(|| {
                        let mut out = Vec::new();
                        policy
                            .decide_input_into(input.input(), &mut out)
                            .map(|_| out)
                    }))
                    .map_err(|_| WorkerFailure::Panicked)
                    .and_then(|v| v.map_err(WorkerFailure::Input));
                    if res_tx.send((token, cmds)).is_err() {
                        break;
                    }
                }
            });
        }
        Self {
            input_kind,
            requirements,
            delivery: delivery::DeliverySession::new(m.me),
            next_request: 1,
            results: Vec::new(),
            results_tick: None,
            observer: ItemObserver::new(m.me),
            fx: None,
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
    /// Attach before the first owned step. Feed every later step even when no worker poll is due.
    /// Binding is one-time. A new session requires a new worker seat, so old replies cannot cross it.
    pub fn bind_fx(&mut self, sim: &Sim) -> Result<(), rh_sim::FxError> {
        if self.fx.is_some() {
            return Err(rh_sim::FxError::AlreadyBound);
        }
        self.fx = Some(rh_sim::FxProjector::attach(sim, self.player()));
        Ok(())
    }

    /// Feed every completed tick independently of worker polling/delivery. An unbound seat starts
    /// a fresh baseline here; call `bind_fx` before its first owned step to retain that step.
    pub fn feed_fx(&mut self, sim: &Sim) {
        if matches!(self.fault, Some(Fault::FxProjection(_))) {
            return;
        }
        let viewer = self.player();
        let Some(fx) = self.fx.as_mut() else {
            self.fx = Some(rh_sim::FxProjector::attach(sim, viewer));
            return;
        };
        match fx.feed(sim.fx_report()) {
            Ok(rh_sim::FeedStatus::Duplicate) => {}
            Ok(_) => {
                if let Err(e) = fx.append_into(sim, viewer, &mut self.seen) {
                    self.seen.clear();
                    self.pending = None;
                    self.fault = Some(Fault::FxProjection(e));
                    return;
                }
                let over = self.seen.len().saturating_sub(MAX_PENDING_EVENTS);
                self.seen.drain(..over);
            }
            Err(e) => {
                self.seen.clear();
                self.pending = None;
                self.fault = Some(Fault::FxProjection(e));
            }
        }
    }

    /// Poll the worker once per tick. Only an actual request or fallback gets an observation and
    /// an offer; completed proposals resolve against this same seat, including delayed clicks.
    pub fn poll(
        &mut self,
        sim: &mut Sim,
        _events: &[Event],
        submitted: impl FnMut(PlayerId, rh_sim::Command),
    ) -> Result<(), OfferError> {
        self.feed_fx(sim);
        collect_results(
            sim.tick(),
            self.player(),
            _events,
            &mut self.results_tick,
            &mut self.results,
        );
        if let Some(Fault::FxProjection(error)) = self.fault {
            self.pending = None;
            while self.rx.try_recv().is_ok() {
                self.late += 1;
            }
            return Err(OfferError::FxProjection(error));
        }
        let tick = sim.tick();
        let mut cmds = Vec::new();
        let expired = self
            .pending
            .clone()
            .filter(|asked| tick > asked.tick.saturating_add(self.deadline_ticks));
        if expired.is_some() {
            self.pending = None;
            self.late += 1;
        }
        let mut failed = false;
        while let Ok((token, answer)) = self.rx.try_recv() {
            if self.fault.is_none() && Some(&token) == self.pending.as_ref() {
                self.pending = None;
                match answer {
                    Ok(proposals) => cmds = proposals,
                    Err(error) => {
                        self.fault = Some(match error {
                            WorkerFailure::Panicked => Fault::Panicked,
                            WorkerFailure::Input(e) => Fault::Input(e),
                        });
                        failed = true;
                    }
                }
            } else if Some(&token) != expired.as_ref() {
                self.late += 1;
            }
        }
        let fallback_due = expired.is_some() || failed;
        let due = tick >= self.next_tick && self.pending.is_none();
        if due || fallback_due {
            if self.next_request == u64::MAX {
                self.fault = Some(Fault::Delivery(delivery::DeliveryError::SampleExhausted));
                return Ok(());
            }
            let offer =
                self.observer
                    .prepare_with_seen(sim, &[], &self.seen, &mut self.obs, None)?;
            let prepared = if self.input_kind == InputKind::Delivered14 {
                match self.delivery.prepare(
                    &self.obs,
                    offer.props_changed(),
                    offer.rewards_changed(),
                    &self.results,
                ) {
                    Ok(v) => Some(v),
                    Err(e) => {
                        self.fault = Some(Fault::Delivery(e));
                        return Ok(());
                    }
                }
            } else {
                None
            };
            if let Some(frame) = &prepared {
                if self.fault.is_none() {
                    if let Err(e) = self.requirements.check(&frame.frame) {
                        self.fault = Some(Fault::Input(e));
                    }
                }
            }
            let token = match &prepared {
                Some(v) => {
                    let c = v.frame.context();
                    RequestToken {
                        session: self.delivery.identity(),
                        epoch: c.epoch,
                        sample: c.sample,
                        tick,
                    }
                }
                None => RequestToken {
                    session: self.delivery.identity(),
                    epoch: crate::bots::delivered::Epoch(1),
                    sample: delivery::SampleId(self.next_request),
                    tick,
                },
            };
            let mut sent = false;
            if due && self.fault.is_none() {
                let input = match &prepared {
                    Some(v) => WorkerInput::Delivered(v.envelope()),
                    None => WorkerInput::Native(Box::new(self.obs.clone())),
                };
                match self.tx.try_send((token.clone(), input)) {
                    Ok(()) => sent = true,
                    Err(mpsc::TrySendError::Disconnected(_)) => {
                        self.fault = Some(Fault::WorkerStopped)
                    }
                    Err(mpsc::TrySendError::Full(_)) => {}
                }
            }
            let mut use_fallback = fallback_due || self.fault.is_some() || (due && !sent);
            if use_fallback {
                let preview = match &prepared {
                    Some(v) => InputPreview::Delivered14(&v.frame),
                    None => InputPreview::NativeCompatibility(&self.obs),
                };
                if let Err(e) = check_receiver(&*self.fallback, preview) {
                    // An already accepted worker request cannot be revoked; fallback refusal alone
                    // cannot undo it. Without a receiver nothing commits or consumes the carry.
                    self.fault = Some(Fault::Input(e));
                    if !sent {
                        return Ok(());
                    }
                    use_fallback = false;
                }
            }
            if sent || use_fallback {
                offer.commit();
                let accepted = prepared.map(|v| self.delivery.commit(v));
                self.seen.clear();
                self.results.clear();
                if due {
                    self.stats.decisions += 1;
                    self.next_tick = tick.saturating_add(self.interval);
                }
                if sent {
                    self.next_request += 1;
                    self.pending = Some(token);
                }
                if use_fallback {
                    self.stats.fallback_decisions += 1;
                    let input = match &accepted {
                        Some(v) => PolicyInput::Delivered14(v),
                        None => PolicyInput::NativeCompatibility(&self.obs),
                    };
                    cmds.clear();
                    let result = catch_unwind(AssertUnwindSafe(|| {
                        self.fallback.decide_input_into(input, &mut cmds)
                    }));
                    match result {
                        Ok(Ok(())) => {}
                        Ok(Err(e)) => {
                            cmds.clear();
                            self.fault = Some(Fault::Input(e));
                        }
                        Err(_) => {
                            cmds.clear();
                            self.fault = Some(Fault::Panicked);
                        }
                    }
                }
            }
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
        for contract in [POLICY_CONTRACT_VERSION - 1, POLICY_CONTRACT_VERSION + 1] {
            let (p, _) = probe(contract, OBSERVATION_VERSION);
            let seat = Seat::new(&m, Box::new(p), Box::new(Idle));
            assert_eq!(seat.fault, Some(Fault::IncompatibleContract { contract }));
        }
        for version in [OBSERVATION_VERSION - 1, OBSERVATION_VERSION + 1] {
            let (p, _) = probe(POLICY_CONTRACT_VERSION, version);
            let seat = Seat::new(&m, Box::new(p), Box::new(Idle));
            assert_eq!(seat.fault, Some(Fault::IncompatibleObservation { version }));
        }
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
            let asked = RequestToken {
                session: seat.delivery.identity(),
                epoch: crate::bots::delivered::Epoch(1),
                sample: delivery::SampleId(1),
                tick: sim.tick(),
            };
            seat.pending = Some(asked.clone());
            seat.next_tick = asked.tick + 100;
            if late {
                tx.send((asked, Ok(vec![PublicCommand::Stop { seq: None }])))
                    .unwrap();
                sim.step();
            } else {
                tx.send((asked, Err(WorkerFailure::Panicked))).unwrap();
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

#[cfg(test)]
mod temporal_tests {
    use super::*;
    use rh_sim::{FactionId, FactionMode, Placement, RawCommand, Secrets, SimConfig, Vec2};
    fn scene() -> Sim {
        scene_with(false)
    }
    fn scene_with(fire: bool) -> Sim {
        Sim::reset_active(
            SimConfig {
                quests: false,
                faction_mode: if fire {
                    FactionMode::EngagementHolyPlagueFire
                } else {
                    FactionMode::EngagementHolyPlague
                },
                ..Default::default()
            },
            rh_sim::arenas::practice_arena(),
            Secrets::from_seed(1),
            &(0..3)
                .map(|i| Placement {
                    profile: format!("p{i}"),
                    faction: if i == 0 {
                        if fire {
                            FactionId::Fire
                        } else {
                            FactionId::Plague
                        }
                    } else {
                        FactionId::Holy
                    },
                    bot: false,
                    at: Vec2::new(400. + 56. * i as f64, 320.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                })
                .collect::<Vec<_>>(),
        )
    }
    #[test]
    fn fire_instant_and_delayed_sync_async_projection() {
        let mut sim = scene_with(true);
        sim.submit(
            PlayerId(2),
            rh_sim::validate(RawCommand::Attack {
                a: std::f64::consts::PI,
                t: None,
            })
            .unwrap(),
        )
        .unwrap();
        let start = MatchStart::of(&sim, PlayerId(2), 1);
        let mut seats = vec![Seat::new(
            &start,
            Box::new(scripted::Idle),
            Box::new(scripted::Idle),
        )];
        let mut asynchronous = AsyncSeat::spawn(
            &start,
            Box::new(scripted::Idle),
            Box::new(scripted::Idle),
            2,
        );
        seats[0].bind_fx(&sim).unwrap();
        asynchronous.bind_fx(&sim).unwrap();
        sim.submit(
            PlayerId(1),
            rh_sim::validate(RawCommand::Attack { a: 0., t: None }).unwrap(),
        )
        .unwrap();
        let mut empty = 0;
        for _ in 0..20 {
            let events = sim.step();
            empty += usize::from(events.is_empty());
            feed_seats(&sim, &mut seats);
            asynchronous.feed_fx(&sim);
            let count = seats[0].pending.len();
            feed_seats(&sim, &mut seats);
            asynchronous.feed_fx(&sim);
            assert_eq!(seats[0].pending.len(), count);
        }
        assert_eq!(seats[0].bind_fx(&sim), Err(rh_sim::FxError::AlreadyBound));
        assert_eq!(
            asynchronous.bind_fx(&sim),
            Err(rh_sim::FxError::AlreadyBound)
        );
        assert!(empty > 0);
        assert_eq!(seats[0].pending, asynchronous.seen);
        assert!(seats[0]
            .pending
            .iter()
            .any(|e| matches!(e, SeenEvent::SignatureHit { .. })));
        assert_eq!(
            seats[0]
                .observer
                .resolve(&sim, PublicCommand::Target { actor: PlayerId(1) }),
            seats[0].observer.resolve(
                &sim,
                PublicCommand::Target {
                    actor: PlayerId(999)
                }
            )
        );
        let mut foreign = sim.clone();
        foreign.step();
        feed_seats(&foreign, &mut seats);
        asynchronous.feed_fx(&foreign);
        assert!(seats[0].pending.is_empty());
        assert!(asynchronous.seen.is_empty());
        assert_eq!(
            seats[0].fault,
            Some(Fault::FxProjection(rh_sim::FxError::ForeignInstance))
        );
        assert_eq!(
            asynchronous.fault,
            Some(Fault::FxProjection(rh_sim::FxError::ForeignInstance))
        );
    }
    #[test]
    fn synchronous_and_async_feed_do_not_depend_on_decisions_or_raw_event_presence() {
        let mut sim = scene();
        let start = MatchStart::of(&sim, PlayerId(2), 1);
        let mut seats = vec![Seat::new(
            &start,
            Box::new(scripted::Idle),
            Box::new(scripted::Idle),
        )];
        let mut asynchronous = AsyncSeat::spawn(
            &start,
            Box::new(scripted::Idle),
            Box::new(scripted::Idle),
            2,
        );
        seats[0].bind_fx(&sim).unwrap();
        asynchronous.bind_fx(&sim).unwrap();
        sim.submit(
            PlayerId(1),
            rh_sim::validate(RawCommand::Attack { a: 0., t: None }).unwrap(),
        )
        .unwrap();
        let mut empty = 0;
        for _ in 0..20 {
            let events = sim.step();
            empty += usize::from(events.is_empty());
            feed_seats(&sim, &mut seats);
            asynchronous.feed_fx(&sim);
            let count = seats[0].pending.len();
            feed_seats(&sim, &mut seats);
            asynchronous.feed_fx(&sim);
            assert_eq!(seats[0].pending.len(), count);
        }
        assert_eq!(seats[0].bind_fx(&sim), Err(rh_sim::FxError::AlreadyBound));
        assert_eq!(
            asynchronous.bind_fx(&sim),
            Err(rh_sim::FxError::AlreadyBound)
        );
        assert!(empty > 0);
        assert_eq!(seats[0].pending, asynchronous.seen);
        assert!(seats[0]
            .pending
            .iter()
            .any(|e| matches!(e, SeenEvent::SignatureHit { .. })));
        assert_eq!(
            seats[0]
                .observer
                .resolve(&sim, PublicCommand::Target { actor: PlayerId(1) }),
            seats[0].observer.resolve(
                &sim,
                PublicCommand::Target {
                    actor: PlayerId(999)
                }
            )
        );
        let mut foreign = sim.clone();
        foreign.step();
        feed_seats(&foreign, &mut seats);
        asynchronous.feed_fx(&foreign);
        assert!(seats[0].pending.is_empty());
        assert!(asynchronous.seen.is_empty());
        assert_eq!(
            seats[0].fault,
            Some(Fault::FxProjection(rh_sim::FxError::ForeignInstance))
        );
        assert_eq!(
            asynchronous.fault,
            Some(Fault::FxProjection(rh_sim::FxError::ForeignInstance))
        );
    }
}

#[cfg(test)]
mod async_session_tests {
    use super::*;
    use rh_sim::{FactionId, Placement, Secrets, SimConfig, Vec2};
    struct Controlled {
        received: mpsc::Sender<u32>,
        release: mpsc::Receiver<()>,
    }
    impl Policy for Controlled {
        fn spec(&self) -> PolicySpec {
            let mut spec = scripted::Idle.spec();
            spec.decision_interval_ticks = 100;
            spec
        }
        fn reset(&mut self, _: &MatchStart) {}
        fn decide(&mut self, obs: &Observation) -> Vec<PublicCommand> {
            self.received.send(obs.tick).unwrap();
            self.release.recv().unwrap();
            vec![PublicCommand::Move {
                x: 800.,
                y: 320.,
                seq: None,
            }]
        }
    }
    fn seat(sim: &Sim) -> (AsyncSeat, mpsc::Receiver<u32>, mpsc::Sender<()>) {
        let (sent, received) = mpsc::channel();
        let (release, wait) = mpsc::channel();
        let mut seat = AsyncSeat::spawn(
            &MatchStart::of(sim, PlayerId(1), 7),
            Box::new(Controlled {
                received: sent,
                release: wait,
            }),
            Box::new(scripted::Idle),
            20,
        );
        seat.bind_fx(sim).unwrap();
        (seat, received, release)
    }
    #[test]
    #[allow(clippy::disallowed_methods)] // Harness timeout for a real worker handshake, never a policy decision.
    fn a_real_late_worker_reply_cannot_cross_a_faulted_session() {
        let mut original = Sim::reset_active(
            SimConfig::default(),
            rh_sim::arenas::practice_arena(),
            Secrets::from_seed(5),
            &(0..2)
                .map(|i| Placement {
                    profile: format!("p{i}"),
                    faction: FactionId::Holy,
                    bot: false,
                    at: Vec2::new(400. + 800. * i as f64, 320.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                })
                .collect::<Vec<_>>(),
        );
        let (mut old, received, release) = seat(&original);
        old.poll(&mut original, &[], |_, _| panic!("worker is held"))
            .unwrap();
        assert_eq!(received.recv_timeout(Duration::from_secs(5)).unwrap(), 1);
        assert_eq!(old.pending.as_ref().unwrap().tick, 1);
        assert_eq!(old.next_tick, 101);
        let mut foreign = original.clone();
        foreign.step();
        let before_hash = foreign.state_hash();
        let refused = Err(OfferError::FxProjection(rh_sim::FxError::ForeignInstance));
        assert_eq!(
            old.poll(&mut foreign, &[], |_, _| panic!("fault cannot submit")),
            refused
        );
        assert!(old.pending.is_none());
        release.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while old.late == 0 {
            assert!(
                Instant::now() < deadline,
                "real worker reply did not arrive"
            );
            assert_eq!(
                old.poll(&mut foreign, &[], |_, _| panic!("stale reply submitted")),
                refused
            );
            std::thread::yield_now();
        }
        assert_eq!(
            foreign.state_hash(),
            before_hash,
            "fault/polls queued no input"
        );
        assert_eq!(old.stats.accepted, 0);
        assert_eq!(old.stats.fallback_decisions, 0);
        assert_eq!(
            old.next_tick, 101,
            "failure did not advance decision cadence"
        );
        let before = foreign.player(PlayerId(1)).unwrap().pos();
        foreign.step();
        assert_eq!(
            foreign.player(PlayerId(1)).unwrap().pos(),
            before,
            "stale move must not execute"
        );
        // A new seat bound to this actual instance accepts its own real reply between decision ticks.
        let (mut fresh, received, release) = seat(&foreign);
        fresh
            .poll(&mut foreign, &[], |_, _| panic!("fresh worker is held"))
            .unwrap();
        assert_eq!(
            received.recv_timeout(Duration::from_secs(5)).unwrap(),
            foreign.tick()
        );
        release.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut submitted = 0;
        while fresh.pending.is_some() {
            assert!(Instant::now() < deadline);
            fresh
                .poll(&mut foreign, &[], |_, _| submitted += 1)
                .unwrap();
            std::thread::yield_now();
        }
        assert_eq!(submitted, 1);
        assert_eq!(fresh.stats.accepted, 1);
        assert_eq!(fresh.fault, None);
        foreign.step();
        assert_eq!(foreign.player(PlayerId(1)).unwrap().body.x, before.x + 8.5);
    }
}

#[cfg(test)]
mod frost_tests {
    use super::*;
    use rh_sim::{FactionId, FactionMode, Placement, RawCommand, Secrets, SimConfig, Vec2};
    struct ChilledWalk {
        seen: Arc<std::sync::Mutex<Vec<Observation>>>,
    }
    impl Policy for ChilledWalk {
        fn spec(&self) -> PolicySpec {
            PolicySpec {
                name: "frost-public-probe".into(),
                version: "1".into(),
                contract: POLICY_CONTRACT_VERSION,
                observation_version: OBSERVATION_VERSION,
                decision_interval_ticks: 1,
            }
        }
        fn reset(&mut self, _: &MatchStart) {}
        fn decide(&mut self, obs: &Observation) -> Vec<PublicCommand> {
            self.seen.lock().unwrap().push(obs.clone());
            if obs.me.as_ref().is_some_and(|p| p.sig & 1 != 0) {
                vec![PublicCommand::Move {
                    x: 550.,
                    y: 320.,
                    seq: None,
                }]
            } else {
                Vec::new()
            }
        }
    }
    #[test]
    fn frost_policy_receives_public_chill_and_moves_through_normal_intake() {
        let mut s = Sim::reset_active(
            SimConfig {
                quests: false,
                faction_mode: FactionMode::EngagementHolyPlagueFireFrost,
                ..Default::default()
            },
            rh_sim::arenas::practice_arena(),
            Secrets::from_seed(12),
            &(0..2)
                .map(|i| Placement {
                    profile: format!("p{i}"),
                    faction: if i == 0 {
                        FactionId::Frost
                    } else {
                        FactionId::Holy
                    },
                    bot: false,
                    at: Vec2::new(400. + 56. * i as f64, 320.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                })
                .collect::<Vec<_>>(),
        );
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let start = MatchStart::of(&s, PlayerId(2), 13);
        let mut seats = [Seat::new(
            &start,
            Box::new(ChilledWalk {
                seen: Arc::clone(&seen),
            }),
            Box::new(scripted::Idle),
        )];
        seats[0].bind_fx(&s).unwrap();
        s.submit(
            PlayerId(1),
            rh_sim::validate(RawCommand::Attack { a: 0., t: None }).unwrap(),
        )
        .unwrap();
        for _ in 0..15 {
            let events = s.step();
            drive_seats(&mut s, &mut seats, &events);
        }
        assert!(seats[0].fault.is_none());
        assert!(s.player(PlayerId(2)).unwrap().body.x > 456.);
        let seen = seen.lock().unwrap();
        assert!(seen
            .iter()
            .any(|o| o.me.as_ref().is_some_and(|p| p.sig & 1 != 0)));
        assert!(seen
            .iter()
            .all(|o| o.version == rh_sim::OBSERVATION_VERSION));
        assert_eq!(POLICY_CONTRACT_VERSION, 23);
    }
}

#[cfg(test)]
mod sentenced_temporal_tests {
    use super::*;
    use rh_sim::RawCommand;
    fn scene() -> Sim {
        Sim::reset_active(
            rh_sim::SimConfig {
                quests: false,
                faction_mode: rh_sim::FactionMode::EngagementHolyPlagueFireFrostSentenced,
                ..Default::default()
            },
            rh_sim::arenas::practice_arena(),
            rh_sim::Secrets::from_seed(12),
            &(0..3)
                .map(|i| rh_sim::Placement {
                    profile: format!("p{i}"),
                    faction: if i == 0 {
                        rh_sim::FactionId::Sentenced
                    } else {
                        rh_sim::FactionId::Holy
                    },
                    bot: false,
                    at: rh_sim::Vec2::new(400. + i as f64 * 56., 320.),
                    hp: None,
                    weapon0: None,
                    weapon1: None,
                })
                .collect::<Vec<_>>(),
        )
    }
    #[test]
    fn sentenced_synchronous_async_feed_retains_every_step() {
        let mut sim = scene();
        let start = MatchStart::of(&sim, PlayerId(2), 1);
        let mut seats = vec![Seat::new(
            &start,
            Box::new(scripted::Idle),
            Box::new(scripted::Idle),
        )];
        let mut asynchronous = AsyncSeat::spawn(
            &start,
            Box::new(scripted::Idle),
            Box::new(scripted::Idle),
            2,
        );
        seats[0].bind_fx(&sim).unwrap();
        asynchronous.bind_fx(&sim).unwrap();
        sim.submit(
            PlayerId(1),
            rh_sim::validate(RawCommand::Attack { a: 0., t: None }).unwrap(),
        )
        .unwrap();
        let mut empty = 0;
        for _ in 0..20 {
            let events = sim.step();
            empty += usize::from(events.is_empty());
            feed_seats(&sim, &mut seats);
            asynchronous.feed_fx(&sim);
            let count = seats[0].pending.len();
            feed_seats(&sim, &mut seats);
            asynchronous.feed_fx(&sim);
            assert_eq!(seats[0].pending.len(), count);
        }
        assert_eq!(seats[0].bind_fx(&sim), Err(rh_sim::FxError::AlreadyBound));
        assert_eq!(
            asynchronous.bind_fx(&sim),
            Err(rh_sim::FxError::AlreadyBound)
        );
        assert!(empty > 0);
        assert_eq!(seats[0].pending, asynchronous.seen);
        assert!(seats[0]
            .pending
            .iter()
            .any(|e| matches!(e, SeenEvent::SignatureHit { .. })));
        assert_eq!(
            seats[0]
                .observer
                .resolve(&sim, PublicCommand::Target { actor: PlayerId(1) }),
            seats[0].observer.resolve(
                &sim,
                PublicCommand::Target {
                    actor: PlayerId(999)
                }
            )
        );
        let mut foreign = sim.clone();
        foreign.step();
        feed_seats(&foreign, &mut seats);
        asynchronous.feed_fx(&foreign);
        assert!(seats[0].pending.is_empty());
        assert!(asynchronous.seen.is_empty());
        assert_eq!(
            seats[0].fault,
            Some(Fault::FxProjection(rh_sim::FxError::ForeignInstance))
        );
        assert_eq!(
            asynchronous.fault,
            Some(Fault::FxProjection(rh_sim::FxError::ForeignInstance))
        );
    }
}

#[cfg(test)]
mod sentenced_projection_fault_tests;

#[cfg(test)]
mod delivery_tests;
