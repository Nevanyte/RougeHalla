//! The headless environment: reset / step over the authoritative [`Sim`] at the same fixed timestep as the live server,
//! with no waiting. It is the seam future training code would drive (docs/adr/0005-policy-seam.md) and the engine of the
//! bot-vs-bot runs, determinism tests and benches. Built-in policies sit in seats; external agents (a test, later a
//! trainer) act for their own players through [`Env::step`]. Both go through the same input path.

mod command_delay;
pub mod digest;
pub mod telemetry_record;
pub mod tournament;
pub mod tournament_cli;
pub mod tournament_learning;

use rh_policy::{drive_seats_with, scripted, submit_all, MatchStart, Policy, Seat, SeatStats};
use rh_sim::replay::{Recorder, Replay, ReplayInput, ReplayStart};
use rh_sim::{
    Arena, ContainerKind, Event, FactionId, ItemObserver, Observation, OfferError, Phase,
    Placement, PlayerId, PublicCommand, RunResult, Secrets, SightCache, Sim, SimConfig, Vec2,
    WeaponId,
};

pub enum Agent {
    /// Driven by a built-in policy seat (cadence, fallback and faults handled by rh-policy).
    Policy { policy: Box<dyn Policy> },
    /// Driven by the caller through `Env::step`.
    External,
}

pub struct AgentSpec {
    pub profile: String,
    pub faction: FactionId,
    pub bot: bool,
    pub agent: Agent,
}

pub struct EnvConfig {
    pub arena: Arena,
    pub sim: SimConfig,
    /// Truncate a match after this many ticks (an explicit `truncated` status, distinct from a terminal end).
    pub max_ticks: u32,
    pub record: bool,
}

pub struct StepOut {
    pub tick: u32,
    pub events: Vec<Event>,
    /// Observations for the EXTERNAL agents, in their spec order.
    pub observations: Vec<Observation>,
    /// The match ended by its own rules (a winner or a draw).
    pub terminated: bool,
    /// Stopped by the runner's tick limit, not by the rules.
    pub truncated: bool,
    pub results: Vec<(PlayerId, RunResult)>,
}

/// Where a step left the match.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Progress {
    pub tick: u32,
    pub terminated: bool,
    pub truncated: bool,
}

pub struct Env {
    max_ticks: u32,
    pub sim: Sim,
    seats: Vec<Seat>,
    /// The seats' line-of-sight memo (derived, outside the sim).
    sight: SightCache,
    external: Vec<PlayerId>,
    observers: Vec<ItemObserver>,
    fx: Vec<rh_sim::FxProjector>,
    fx_fault: Option<rh_sim::FxError>,
    fx_pending: Vec<Vec<rh_sim::SeenEvent>>,
    fx_delivered: Vec<bool>,
    recorder: Option<Recorder>,
    last_events: Vec<Event>,
    start_tick: u32,
    command_delay: Option<command_delay::CommandDelay>,
}

impl Env {
    /// Builds a match: players placed on the arena's spawns in order, the run active. `seed` derives the match secrets and
    /// every policy's own seed (independent resets: nothing carries over from an earlier match).
    pub fn new(cfg: EnvConfig, agents: Vec<AgentSpec>, seed: u64) -> Self {
        Self::new_delayed(cfg, agents, seed, None)
    }

    /// Tournament diagnostic only: delay commands, not observations. Delivery still uses each seat's
    /// ItemObserver and normal simulation intake. The ordinary Env path is unchanged.
    pub(crate) fn new_delayed(
        cfg: EnvConfig,
        agents: Vec<AgentSpec>,
        seed: u64,
        delay: Option<(f64, f64)>,
    ) -> Self {
        let mut command_delay =
            delay.map(|(latency, jitter)| command_delay::CommandDelay::new(latency, jitter));
        let secrets = Secrets::from_seed(seed);
        let spawns = &cfg.arena.spawns;
        let placements: Vec<Placement> = agents
            .iter()
            .enumerate()
            .map(|(i, a)| Placement {
                profile: a.profile.clone(),
                faction: a.faction,
                bot: a.bot,
                at: if spawns.is_empty() {
                    cfg.arena.centre()
                } else {
                    spawns[(i * 7 + seed as usize) % spawns.len()]
                },
                hp: None,
                weapon0: None,
                weapon1: None,
            })
            .collect();
        let (sim, recorder) = if matches!(cfg.sim.lifecycle, rh_sim::ArenaMode::Source(_)) {
            let mut sim = Sim::new(cfg.sim.clone(), cfg.arena.clone(), secrets);
            let mut recorder = cfg
                .record
                .then(|| Recorder::new(&sim, cfg.sim.clone(), ReplayStart::Lobby));
            for a in &agents {
                sim.add_player(&a.profile, Some(a.faction), a.bot)
                    .expect("admitted headless player");
                if let Some(r) = &mut recorder {
                    r.record(ReplayInput::Join {
                        profile: a.profile.clone(),
                        faction: Some(a.faction),
                        bot: a.bot,
                        policy: None,
                    });
                }
            }
            (sim, recorder)
        } else {
            let sim = Sim::reset_active(cfg.sim.clone(), cfg.arena.clone(), secrets, &placements);
            let recorder = cfg.record.then(|| {
                Recorder::new(
                    &sim,
                    cfg.sim.clone(),
                    ReplayStart::Active {
                        placements: placements.clone(),
                    },
                )
            });
            (sim, recorder)
        };
        let mut seats = Vec::new();
        let mut external = Vec::new();
        for (i, a) in agents.into_iter().enumerate() {
            let id = sim.players()[i].id;
            match a.agent {
                Agent::Policy { policy } => {
                    let start =
                        MatchStart::of(&sim, id, seed.wrapping_mul(31).wrapping_add(i as u64));
                    if let Some(delay) = &mut command_delay {
                        delay.add_seat(id, start.seed);
                    }
                    seats.push(Seat::new(&start, policy, Box::new(scripted::Idle)));
                }
                Agent::External => external.push(id),
            }
        }
        for seat in &mut seats {
            seat.bind_fx(&sim).expect("new policy seat is unbound");
        }
        let start_tick = sim.tick();
        Self {
            max_ticks: cfg.max_ticks,
            seats,
            sight: SightCache::new(),
            observers: external.iter().copied().map(ItemObserver::new).collect(),
            fx: external
                .iter()
                .map(|&id| rh_sim::FxProjector::attach(&sim, id))
                .collect(),
            fx_fault: None,
            fx_pending: external
                .iter()
                .map(|_| Vec::with_capacity(rh_policy::MAX_PENDING_EVENTS))
                .collect(),
            fx_delivered: vec![false; external.len()],
            external,
            recorder,
            last_events: Vec::new(),
            start_tick,
            command_delay,
            sim,
        }
    }

    /// Start a fresh external session from authoritative state. All seats are external in this
    /// session. The caller discards the old transport/input stream; its policy lifecycle and offers
    /// are deliberately not restored. Already queued private commands stay in the simulation.
    pub fn from_external_checkpoint(
        sim: Sim,
        max_ticks: u32,
    ) -> Result<(Self, Vec<Observation>), OfferError> {
        let external: Vec<_> = sim.players().iter().map(|p| p.id).collect();
        let mut env = Self {
            max_ticks,
            seats: Vec::new(),
            sight: SightCache::new(),
            observers: external.iter().copied().map(ItemObserver::new).collect(),
            fx: external
                .iter()
                .map(|&id| rh_sim::FxProjector::attach(&sim, id))
                .collect(),
            fx_fault: None,
            fx_pending: external
                .iter()
                .map(|_| Vec::with_capacity(rh_policy::MAX_PENDING_EVENTS))
                .collect(),
            fx_delivered: vec![false; external.len()],
            external,
            recorder: None,
            last_events: Vec::new(),
            start_tick: sim.tick(),
            command_delay: None,
            sim,
        };
        let full = env.try_observations()?;
        Ok((env, full))
    }

    /// Deliver one external player's observation into a reusable buffer. This samples only this
    /// seat. The agent index follows external_players() order.
    pub fn observe_external_into(
        &mut self,
        agent: usize,
        out: &mut Observation,
    ) -> Result<(), OfferError> {
        if let Some(e) = self.fx_fault {
            return Err(OfferError::FxProjection(e));
        }
        let fx = self.fx.get(agent).ok_or(OfferError::UnknownExternalSeat)?;
        fx.check_delivery(&self.sim, self.external[agent])
            .map_err(OfferError::FxProjection)?;
        self.observers
            .get_mut(agent)
            .ok_or(OfferError::UnknownExternalSeat)?
            .prepare_with_seen(
                &self.sim,
                &[],
                &self.fx_pending[agent],
                out,
                Some(&mut self.sight),
            )?
            .commit();
        self.fx_delivered[agent] = true;
        Ok(())
    }

    /// Hits and misses of the seats' line-of-sight memo so far (diagnostics).
    pub fn sight_stats(&self) -> rh_sim::SightStats {
        self.sight.stats()
    }

    pub fn external_players(&self) -> &[PlayerId] {
        &self.external
    }

    /// Trusted scenario setup. Record it in the same input order as live actions.
    pub fn seed_weapon_container(
        &mut self,
        kind: ContainerKind,
        at: Vec2,
        weapons: &[WeaponId],
    ) -> Result<(), &'static str> {
        self.sim.seed_weapon_container(kind, at, weapons)?;
        if let Some(rec) = self.recorder.as_mut() {
            rec.record(ReplayInput::WeaponRack {
                kind,
                at,
                weapons: weapons.to_vec(),
            });
        }
        Ok(())
    }

    /// Sample all external observers atomically. Only a returned observation issues handles.
    pub fn try_observations(&mut self) -> Result<Vec<Observation>, OfferError> {
        if let Some(e) = self.fx_fault {
            return Err(OfferError::FxProjection(e));
        }
        let mut observations = Vec::with_capacity(self.observers.len());
        let mut offers = Vec::with_capacity(self.observers.len());
        for (agent, (observer, fx)) in self.observers.iter_mut().zip(&self.fx).enumerate() {
            let mut observation = Observation::default();
            let viewer = observer.viewer();
            offers.push(observer.prepare_with_seen(
                &self.sim,
                &[],
                &self.fx_pending[agent],
                &mut observation,
                None,
            )?);
            fx.check_delivery(&self.sim, viewer)
                .map_err(OfferError::FxProjection)?;
            observations.push(observation);
        }
        for offer in offers {
            offer.commit();
        }
        self.fx_delivered.fill(true);
        Ok(observations)
    }

    /// Trusted scene wrapper. Arbitrary-checkpoint/external delivery uses [`Self::try_observations`].
    pub fn observations(&mut self) -> Vec<Observation> {
        self.try_observations()
            .expect("scene exceeds external observation bounds")
    }

    /// Trusted scene wrapper for one fixed step. Use [`Self::try_step`] for fallible external delivery.
    /// External commands (one list per external player), then policy seats, then the sim.
    pub fn step(&mut self, external_cmds: &[Vec<PublicCommand>]) -> StepOut {
        self.try_step(external_cmds)
            .expect("scene exceeds external observation bounds")
    }

    /// Advance once, returning a typed error if a complete public view cannot be delivered.
    /// After such an error the simulation has stepped but no external observer issued new handles.
    pub fn try_step(
        &mut self,
        external_cmds: &[Vec<PublicCommand>],
    ) -> Result<StepOut, OfferError> {
        let p = self.advance(external_cmds);
        let events = self.last_events.clone();
        let results = events
            .iter()
            .filter_map(|e| {
                if let Event::Resolved { id, result, .. } = e {
                    Some((*id, result.clone()))
                } else {
                    None
                }
            })
            .collect();
        Ok(StepOut {
            tick: p.tick,
            observations: self.try_observations()?,
            events,
            terminated: p.terminated,
            truncated: p.truncated,
            results,
        })
    }

    /// [`Env::step`] without the owned report: the step's events stay in the env ([`Env::last_events`], one buffer
    /// reused every step through `Sim::step_into`), so a runner that only folds them allocates nothing per step on the
    /// sim's side.
    pub fn advance(&mut self, external_cmds: &[Vec<PublicCommand>]) -> Progress {
        let mut ext_stats = SeatStats::default();
        for (observer, cmds) in self.observers.iter().zip(external_cmds) {
            submit_all(
                &mut self.sim,
                observer,
                cmds,
                &mut ext_stats,
                |player, cmd| {
                    if let Some(rec) = self.recorder.as_mut() {
                        rec.record(ReplayInput::Command { player, cmd });
                    }
                },
            );
        }
        self.drive_and_record();
        self.last_events.clear();
        self.sim.step_into(&mut self.last_events);
        rh_policy::feed_seats(&self.sim, &mut self.seats);
        for (i, fx) in self.fx.iter_mut().enumerate() {
            if self.fx_delivered[i] {
                self.fx_pending[i].clear();
                self.fx_delivered[i] = false;
            }
            match fx.feed(self.sim.fx_report()).and_then(|status| {
                if status != rh_sim::FeedStatus::Duplicate {
                    fx.append_into(&self.sim, self.external[i], &mut self.fx_pending[i])?;
                }
                Ok(status)
            }) {
                Ok(_) => {
                    let over = self.fx_pending[i]
                        .len()
                        .saturating_sub(rh_policy::MAX_PENDING_EVENTS);
                    self.fx_pending[i].drain(..over);
                }
                Err(e) => {
                    self.fx_pending[i].clear();
                    self.fx_fault = Some(e);
                }
            }
        }
        if let Some(rec) = self.recorder.as_mut() {
            rec.stepped(&self.sim);
        }
        let terminated = self.sim.phase() == Phase::Ended;
        let truncated = !terminated && self.sim.tick() - self.start_tick >= self.max_ticks;
        Progress {
            tick: self.sim.tick(),
            terminated,
            truncated,
        }
    }

    /// The events of the last step, in order.
    pub fn last_events(&self) -> &[Event] {
        &self.last_events
    }

    fn drive_and_record(&mut self) {
        let rec = &mut self.recorder;
        if let Some(delay) = &mut self.command_delay {
            let now = self.sim.server_time();
            let mut refused = Vec::new();
            rh_policy::drive_seats_queued(
                &mut self.sim,
                &mut self.seats,
                &self.last_events,
                &mut self.sight,
                |player, proposal| {
                    if !delay.enqueue(player, now, proposal) {
                        refused.push(player);
                    }
                },
            );
            for player in refused {
                self.seats
                    .iter_mut()
                    .find(|s| s.player() == player)
                    .expect("owned seat")
                    .note_delivery(false);
            }
            // Source BotManager.beforeStep(stepT): delivery runs at EVERY upcoming fixed step,
            // including steps where the policy is not due. The observation remains at `now`.
            for (player, proposal) in delay.drain(now + rh_sim::constants::TICK_MS) {
                let seat = self
                    .seats
                    .iter_mut()
                    .find(|s| s.player() == player)
                    .expect("owned seat");
                let command = if matches!(seat.fault, Some(rh_policy::Fault::FxProjection(_))) {
                    None
                } else {
                    seat.resolve(&self.sim, proposal)
                };
                let accepted = command.is_some_and(|cmd| {
                    if let Some(r) = rec.as_mut() {
                        r.record(ReplayInput::Command { player, cmd });
                    }
                    self.sim.submit(player, cmd).is_ok()
                });
                seat.note_delivery(accepted);
            }
            return;
        }
        drive_seats_with(
            &mut self.sim,
            &mut self.seats,
            &self.last_events,
            &mut self.sight,
            |player, cmd| {
                if let Some(r) = rec.as_mut() {
                    r.record(ReplayInput::Command { player, cmd });
                }
            },
        );
    }

    /// The policy telemetry snapshots, in seat order (the tournament report's behaviour block).
    pub fn seat_telemetry(&self) -> Vec<Option<rh_policy::PolicyStats>> {
        self.seats.iter().map(Seat::stats).collect()
    }

    /// The end-of-run summary of `player`'s policy seat (source `seat.runner.end(result)`), asked once per seat: `None`
    /// for an external player, a second call, a faulted seat, or a policy that reports nothing ([`Seat::finish`]).
    pub fn finish_seat(
        &mut self,
        player: PlayerId,
        result: Option<&RunResult>,
    ) -> Option<rh_policy::PolicyFinish> {
        self.seats
            .iter_mut()
            .find(|seat| seat.player() == player)
            .and_then(|seat| seat.finish(result))
    }

    pub fn seat_stats(&self) -> Vec<(PlayerId, SeatStats, Option<rh_policy::Fault>)> {
        self.seats
            .iter()
            .map(|s| (s.player(), s.stats.clone(), s.fault.clone()))
            .collect()
    }

    pub fn into_replay(self) -> Option<Replay> {
        self.recorder.map(|r| r.replay)
    }
}

/// Runs a bot-only match to its end or the tick limit. Returns (ticks, terminated, results, final state hash).
pub fn run_bot_match(
    arena: &Arena,
    players: usize,
    seed: u64,
    max_ticks: u32,
    record: bool,
) -> (Env, MatchSummary) {
    run_bot_match_with(arena, players, seed, max_ticks, record, false)
}

/// [`run_bot_match`], optionally folding the [`digest::OutcomeDigest`] of every tick into
/// [`MatchSummary::outcome_digest`] (an observer: it reads the sim after each step and changes nothing).
pub fn run_bot_match_with(
    arena: &Arena,
    players: usize,
    seed: u64,
    max_ticks: u32,
    record: bool,
    digest: bool,
) -> (Env, MatchSummary) {
    run_bot_match_config(
        arena,
        SimConfig::default(),
        players,
        seed,
        max_ticks,
        record,
        digest,
    )
}

/// Which built-in policy a bot-only match seats (P-BOT-BRAIN-LIVE-1).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum BotKind {
    /// The scripted Brawler (the historical default of every headless run).
    #[default]
    Brawler,
    /// The live fill bot: HumanBot with the manager's tier/persona draw.
    Human,
    /// The ported legacy Brain on the degraded fair profile, with the same tier/persona draw. It needs the source
    /// lifecycle (`ArenaMode::Source`); elsewhere it refuses and the seat's fallback plays.
    Brain,
}

impl BotKind {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "brawler" => Some(Self::Brawler),
            "human" => Some(Self::Human),
            "brain" => Some(Self::Brain),
            _ => None,
        }
    }

    /// The policy for seat `i` of `players` in a match of `seed`.
    pub fn policy(
        self,
        arena: &Arena,
        sim: &SimConfig,
        players: usize,
        seed: u64,
        i: usize,
    ) -> Box<dyn Policy> {
        match self {
            Self::Brawler => Box::new(scripted::Brawler::new(2 + (i as u32 % 3))),
            Self::Human | Self::Brain => {
                let (tier, persona) = rh_policy::bots::assign_seats(seed, players)[i];
                if self == Self::Human {
                    Box::new(rh_policy::bots::HumanBot::new(tier, persona))
                } else {
                    Box::new(rh_policy::bots::BrainBot::new(
                        tier,
                        persona,
                        rh_policy::bots::brain_features(sim, arena),
                    ))
                }
            }
        }
    }
}

/// [`run_bot_match_with`] on a given configuration (the CLI's `--hitboxes archetypes` runs the ADR0024 boxes).
pub fn run_bot_match_config(
    arena: &Arena,
    sim: SimConfig,
    players: usize,
    seed: u64,
    max_ticks: u32,
    record: bool,
    digest: bool,
) -> (Env, MatchSummary) {
    run_bot_match_kind(
        arena,
        sim,
        players,
        seed,
        max_ticks,
        record,
        digest,
        BotKind::Brawler,
    )
}

/// [`run_bot_match_config`] with a chosen built-in policy for every seat.
#[allow(clippy::too_many_arguments)]
pub fn run_bot_match_kind(
    arena: &Arena,
    sim: SimConfig,
    players: usize,
    seed: u64,
    max_ticks: u32,
    record: bool,
    digest: bool,
    kind: BotKind,
) -> (Env, MatchSummary) {
    let agents = (0..players)
        .map(|i| AgentSpec {
            profile: format!("bot{i}"),
            faction: FactionId::ALL[(i + seed as usize) % 5],
            bot: true,
            agent: Agent::Policy {
                policy: kind.policy(arena, &sim, players, seed, i),
            },
        })
        .collect();
    let mut env = Env::new(
        EnvConfig {
            arena: arena.clone(),
            sim,
            max_ticks,
            record,
        },
        agents,
        seed,
    );
    let mut summary = MatchSummary::default();
    let mut fold = digest.then(digest::OutcomeDigest::new);
    loop {
        let out = env.advance(&[]);
        let events = env.last_events();
        if let Some(d) = fold.as_mut() {
            d.tick(&env.sim, events);
        }
        summary.ticks += 1;
        for e in events {
            match e {
                Event::Resolved { id, result, .. } => summary.results.push((*id, result.clone())),
                Event::Hit { .. } => summary.hits += 1,
                _ => {}
            }
        }
        if out.terminated || out.truncated {
            summary.terminated = out.terminated;
            summary.truncated = out.truncated;
            break;
        }
    }
    summary.state_hash = env.sim.state_hash();
    summary.outcome_digest = fold.map(|d| d.value());
    (env, summary)
}

#[derive(Default, Debug, Clone, serde::Serialize)]
pub struct MatchSummary {
    pub ticks: u32,
    pub terminated: bool,
    pub truncated: bool,
    pub hits: u64,
    #[serde(skip)]
    pub results: Vec<(PlayerId, RunResult)>,
    pub state_hash: u64,
    /// The match's [`digest::OutcomeDigest`] (hash-independent behaviour fingerprint), when asked for.
    pub outcome_digest: Option<u64>,
}

/// Loads a legacy `rh-map/1` collision file or an admitted `rh-map/2` full gameplay map.
pub fn load_arena(path: &str) -> Result<Arena, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    #[derive(serde::Deserialize)]
    struct Tag {
        format: String,
    }
    let tag: Tag = serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?;
    match tag.format.as_str() {
        "rh-map/1" => {
            let file: rh_sim::arenas::MapFile =
                serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?;
            file.into_arena()
        }
        "rh-map/2" => {
            let file: rh_sim::mapdata::MapExport =
                serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?;
            file.validate()
                .map_err(|e| format!("{path}: {e}"))?
                .into_arena()
                .map_err(|e| format!("{path}: {e}"))
        }
        other => Err(format!("{path}: unknown map format {other:?}")),
    }
}

pub fn centre_of(a: &Arena) -> Vec2 {
    a.centre()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_outcome_digest_is_a_behaviour_fingerprint() {
        let arena = rh_sim::arenas::practice_arena();
        let d = |seed, record| {
            run_bot_match_with(&arena, 4, seed, 600, record, true)
                .1
                .outcome_digest
                .expect("asked for")
        };
        // Deterministic, and an observer: recording does not change what happened.
        assert_eq!(d(3, false), d(3, false));
        assert_eq!(d(3, false), d(3, true));
        // Another match (other secrets, other bot seeds) is another digest.
        assert_ne!(d(3, false), d(4, false));
        assert!(run_bot_match(&arena, 4, 3, 50, false)
            .1
            .outcome_digest
            .is_none());
    }

    #[test]
    fn the_outcome_digest_sees_one_changed_event_or_field() {
        let arena = rh_sim::arenas::practice_arena();
        let (env, _) = run_bot_match(&arena, 2, 1, 40, false);
        let sim = env.sim;
        let hit = |amount| Event::Hit {
            victim: PlayerId(1),
            by: Some(PlayerId(2)),
            amount,
            weapon: Some(rh_sim::WeaponId::Fists),
            passive: false,
            critical: false,
        };
        let one = |events: &[Event]| {
            let mut d = digest::OutcomeDigest::new();
            d.tick(&sim, events);
            d.value()
        };
        let free = Event::Hit {
            victim: PlayerId(1),
            by: None,
            amount: 10.0,
            weapon: None,
            passive: false,
            critical: false,
        };
        assert_ne!(one(&[hit(10.0)]), one(std::slice::from_ref(&free)));
        assert_eq!(
            one(std::slice::from_ref(&free)),
            one(std::slice::from_ref(&free))
        );
        assert_eq!(one(&[hit(10.0)]), one(&[hit(10.0)]));
        assert_ne!(one(&[hit(10.0)]), one(&[hit(10.000000000000002)]));
        let mut passive = hit(10.0);
        if let Event::Hit {
            passive: marker, ..
        } = &mut passive
        {
            *marker = true;
        }
        assert_ne!(one(&[hit(10.0)]), one(&[passive]));
        assert_ne!(one(&[hit(10.0)]), one(&[]));
        // One public field one ulp off.
        // (State is written from outside the core only through a checkpoint.)
        let mut cp = serde_json::to_value(&sim).unwrap();
        let t = cp["world"]["server_time"].as_f64().unwrap();
        cp["world"]["server_time"] = serde_json::json!(f64::from_bits(t.to_bits() + 1));
        let other: rh_sim::Sim = serde_json::from_value(cp).unwrap();
        assert_eq!(
            other.server_time(),
            f64::from_bits(sim.server_time().to_bits() + 1)
        );
        assert_ne!(one(&[]), {
            let mut d = digest::OutcomeDigest::new();
            d.tick(&other, &[]);
            d.value()
        });
    }
}
