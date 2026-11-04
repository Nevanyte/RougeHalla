//! Replays and checkpoints. A replay is the match's starting conditions plus every input in tick order; replaying it through
//! [`run_replay`] reproduces every tick's state hash on the declared targets (docs/CONTRACTS.md C-DET). Because it holds the
//! match's [`crate::Secrets`], a replay is a PRIVATE, server-side artifact: publish [`crate::observe::public_snapshot`]s or
//! a replay with its secrets stripped (which then only replays the recorded results, not the hidden order).

use crate::content::FactionId;
use crate::input::Command;
use crate::sim::{Arena, Event, Placement, PlayerId, Secrets, Sim, SimConfig};

pub const REPLAY_FORMAT: &str = "rh-replay/1";

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ReplayInput {
    /// A lobby join (live rooms start from a lobby). `policy` names the bot policy and its own seed, so a headless re-run
    /// can rebuild the same bot and let it decide again (the policy-equivalence check), instead of replaying its commands.
    Join {
        profile: String,
        faction: Option<FactionId>,
        bot: bool,
        policy: Option<BotPolicy>,
    },
    Command {
        player: PlayerId,
        cmd: Command,
    },
    /// Queued with no order budget (the parity harness only).
    Unbudgeted {
        player: PlayerId,
        cmd: Command,
    },
    Leave {
        player: PlayerId,
    },
    Dropped {
        player: PlayerId,
        dropped: bool,
    },
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BotPolicy {
    pub name: String,
    pub interval: u32,
    pub seed: u64,
}

/// How a replay starts: a typed reset with placements (headless, parity) or an empty lobby (a live room).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ReplayStart {
    Active { placements: Vec<Placement> },
    Lobby,
}

/// Inputs applied before the step that makes `sim.tick == tick`.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ReplayTick {
    pub tick: u32,
    pub inputs: Vec<ReplayInput>,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Replay {
    pub format: String,
    pub content_hash: u64,
    pub config: SimConfig,
    pub arena: Arena,
    pub secrets: Secrets,
    pub start: ReplayStart,
    pub ticks: Vec<ReplayTick>,
    /// State hash after every recorded step (index i = after the i-th step past the reset).
    pub hashes: Vec<u64>,
}

/// Records a match driven through it (the headless runner and the live room use the same recorder).
pub struct Recorder {
    pub replay: Replay,
    pending: Vec<ReplayInput>,
}

impl Recorder {
    pub fn new(sim: &Sim, config: SimConfig, start: ReplayStart) -> Self {
        Self {
            replay: Replay {
                format: REPLAY_FORMAT.into(),
                content_hash: crate::content::content_hash(),
                config,
                arena: sim.arena().clone(),
                secrets: sim.secrets_for_replay(),
                start,
                ticks: Vec::new(),
                hashes: Vec::new(),
            },
            pending: Vec::new(),
        }
    }
    pub fn record(&mut self, input: ReplayInput) {
        self.pending.push(input);
    }
    /// Call right after `sim.step()`.
    pub fn stepped(&mut self, sim: &Sim) {
        let inputs = std::mem::take(&mut self.pending);
        if !inputs.is_empty() {
            self.replay.ticks.push(ReplayTick {
                tick: sim.tick(),
                inputs,
            });
        }
        self.replay.hashes.push(sim.state_hash());
    }
}

/// Applies one recorded input to a sim (shared by the recorder's callers and the replayer).
pub fn apply_input(sim: &mut Sim, input: &ReplayInput) {
    match *input {
        ReplayInput::Join {
            ref profile,
            faction,
            bot,
            ..
        } => {
            let _ = sim.add_player(profile, faction, bot);
        }
        ReplayInput::Command { player, cmd } => {
            let _ = sim.submit(player, cmd);
        }
        ReplayInput::Unbudgeted { player, cmd } => {
            let _ = sim.submit_unbudgeted(player, cmd);
        }
        ReplayInput::Leave { player } => sim.remove_player(player),
        ReplayInput::Dropped { player, dropped } => sim.mark_dropped(player, dropped),
    }
}

#[derive(Debug, PartialEq)]
pub enum ReplayError {
    ContentMismatch {
        replay: u64,
        build: u64,
    },
    Diverged {
        step: usize,
        expected: u64,
        got: u64,
    },
}

/// Replays from the reset and checks every step's hash. Returns the final sim and all events.
pub fn run_replay(r: &Replay) -> Result<(Sim, Vec<Event>), ReplayError> {
    let build = crate::content::content_hash();
    if r.content_hash != build {
        return Err(ReplayError::ContentMismatch {
            replay: r.content_hash,
            build,
        });
    }
    let mut sim = start_sim(r);
    let mut events = Vec::new();
    let mut next = 0;
    for (step, &expected) in r.hashes.iter().enumerate() {
        let target = sim.tick() + 1;
        if let Some(t) = r.ticks.get(next) {
            if t.tick == target {
                for i in &t.inputs {
                    apply_input(&mut sim, i);
                }
                next += 1;
            }
        }
        events.extend(sim.step());
        let got = sim.state_hash();
        if got != expected {
            return Err(ReplayError::Diverged {
                step,
                expected,
                got,
            });
        }
    }
    Ok((sim, events))
}

/// The sim a replay starts from.
pub fn start_sim(r: &Replay) -> Sim {
    // A deserialized replay carries the map without its derived tables: rebuild them.
    let mut arena = r.arena.clone();
    arena.map.rebuild();
    match &r.start {
        ReplayStart::Active { placements } => {
            Sim::reset_active(r.config.clone(), arena, r.secrets, placements)
        }
        ReplayStart::Lobby => Sim::new(r.config.clone(), arena, r.secrets),
    }
}
