//! The headless environment: reset / step over the authoritative [`Sim`] at the same fixed timestep as the live server,
//! with no waiting. It is the seam future training code would drive (docs/adr/0005-policy-seam.md) and the engine of the
//! bot-vs-bot runs, determinism tests and benches. Built-in policies sit in seats; external agents (a test, later a
//! trainer) act for their own players through [`Env::step`]. Both go through the same input path.

use rh_policy::{drive_seats_with, scripted, submit_all, Policy, Seat, SeatStats};
use rh_sim::replay::{Recorder, Replay, ReplayInput, ReplayStart};
use rh_sim::{
    observe, Arena, Event, FactionId, Observation, Phase, Placement, PlayerId, RawCommand,
    RunResult, Secrets, Sim, SimConfig, Vec2,
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

pub struct Env {
    cfg: EnvConfig,
    pub sim: Sim,
    seats: Vec<Seat>,
    external: Vec<PlayerId>,
    recorder: Option<Recorder>,
    last_events: Vec<Event>,
    start_tick: u32,
}

impl Env {
    /// Builds a match: players placed on the arena's spawns in order, the run active. `seed` derives the match secrets and
    /// every policy's own seed (independent resets: nothing carries over from an earlier match).
    pub fn new(cfg: EnvConfig, agents: Vec<AgentSpec>, seed: u64) -> Self {
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
            })
            .collect();
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
        let mut seats = Vec::new();
        let mut external = Vec::new();
        for (i, a) in agents.into_iter().enumerate() {
            let id = sim.players()[i].id;
            match a.agent {
                Agent::Policy { policy } => seats.push(Seat::new(
                    id,
                    policy,
                    Box::new(scripted::Idle),
                    seed.wrapping_mul(31).wrapping_add(i as u64),
                )),
                Agent::External => external.push(id),
            }
        }
        let start_tick = sim.tick;
        Self {
            cfg,
            sim,
            seats,
            external,
            recorder,
            last_events: Vec::new(),
            start_tick,
        }
    }

    pub fn external_players(&self) -> &[PlayerId] {
        &self.external
    }

    pub fn observations(&self) -> Vec<Observation> {
        self.external
            .iter()
            .map(|id| observe(&self.sim, *id, &self.last_events))
            .collect()
    }

    /// One fixed step: external agents' commands (one list per external player, in order), then the seats, then the sim.
    pub fn step(&mut self, external_cmds: &[Vec<RawCommand>]) -> StepOut {
        let mut ext_stats = SeatStats::default();
        for (id, cmds) in self.external.iter().zip(external_cmds) {
            for raw in cmds {
                if let (Some(rec), Ok(cmd)) = (self.recorder.as_mut(), rh_sim::validate(*raw)) {
                    rec.record(ReplayInput::Command { player: *id, cmd });
                }
            }
            submit_all(&mut self.sim, *id, cmds.clone(), &mut ext_stats);
        }
        self.drive_and_record();
        let events = self.sim.step();
        if let Some(rec) = self.recorder.as_mut() {
            rec.stepped(&self.sim);
        }
        self.last_events = events.clone();
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
        let terminated = self.sim.phase == Phase::Ended;
        let truncated = !terminated && self.sim.tick - self.start_tick >= self.cfg.max_ticks;
        StepOut {
            tick: self.sim.tick,
            observations: self.observations(),
            events,
            terminated,
            truncated,
            results,
        }
    }

    fn drive_and_record(&mut self) {
        let rec = &mut self.recorder;
        drive_seats_with(
            &mut self.sim,
            &mut self.seats,
            &self.last_events,
            |player, cmd| {
                if let Some(r) = rec.as_mut() {
                    r.record(ReplayInput::Command { player, cmd });
                }
            },
        );
    }

    pub fn seat_stats(&self) -> Vec<(PlayerId, SeatStats, Option<rh_policy::Fault>)> {
        self.seats
            .iter()
            .map(|s| (s.player, s.stats.clone(), s.fault.clone()))
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
    let agents = (0..players)
        .map(|i| AgentSpec {
            profile: format!("bot{i}"),
            faction: FactionId::ALL[(i + seed as usize) % 5],
            bot: true,
            agent: Agent::Policy {
                policy: Box::new(scripted::Brawler::new(2 + (i as u32 % 3))),
            },
        })
        .collect();
    let mut env = Env::new(
        EnvConfig {
            arena: arena.clone(),
            sim: SimConfig::default(),
            max_ticks,
            record,
        },
        agents,
        seed,
    );
    let mut summary = MatchSummary::default();
    loop {
        let out = env.step(&[]);
        summary.ticks += 1;
        summary.results.extend(out.results);
        summary.hits += out
            .events
            .iter()
            .filter(|e| matches!(e, Event::Hit { .. }))
            .count() as u64;
        if out.terminated || out.truncated {
            summary.terminated = out.terminated;
            summary.truncated = out.truncated;
            break;
        }
    }
    summary.state_hash = env.sim.state_hash();
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
}

/// Loads an `rh-map/1` file.
pub fn load_arena(path: &str) -> Result<Arena, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    let f: rh_sim::arenas::MapFile =
        serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?;
    f.into_arena()
}

pub fn centre_of(a: &Arena) -> Vec2 {
    a.centre()
}
