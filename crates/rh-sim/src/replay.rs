//! Replays and checkpoints. A replay is the match's starting conditions plus every input in tick order; replaying it through
//! [`run_replay`] reproduces every tick's state hash on the declared targets (docs/CONTRACTS.md C-DET). Because it holds the
//! match's [`crate::Secrets`], a replay is a PRIVATE, server-side artifact: publish [`crate::observe::public_snapshot`]s or
//! a replay with its secrets stripped (which then only replays the recorded results, not the hidden order).

use crate::content::FactionId;
use crate::input::Command;
use crate::sim::{Arena, Event, Placement, PlayerId, Secrets, Sim, SimConfig};

/// The tag every replay carries. `rh-replay/2`: per-step hashes are the serde-derived word hash of `hash.rs` (`rh-replay/1`
/// held the hand-listed byte-wise FNV hashes, which no build can reproduce any more). [`run_replay`] refuses any other tag.
pub const REPLAY_FORMAT: &str = "rh-replay/2";

/// Identity of the code this binary was built from: the `RH_BUILD` environment variable at compile time (a release build is meant to set
/// it to the commit id; nothing in the repo does yet, so every dev build reads the same), else `dev-<crate version>`. It is a compile-time constant, so reading it keeps
/// `rh-sim` pure. A replay or checkpoint is verified by the build that recorded it and never across builds: the state hash
/// follows the serialized layout of the world, and `content_hash` does not cover system code, so only the recording commit
/// can reproduce a stored file. Releases keep their commit buildable (rust-toolchain.toml and Cargo.lock pin the rest).
pub const BUILD_ID: &str = match option_env!("RH_BUILD") {
    Some(b) => b,
    None => concat!("dev-", env!("CARGO_PKG_VERSION")),
};

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
    /// Run-only scenario setup, replayed through the validated rack constructor.
    WeaponRack {
        kind: crate::ContainerKind,
        at: crate::Vec2,
        weapons: Vec<crate::WeaponId>,
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
    /// The [`BUILD_ID`] that recorded it (the build that can verify it). Empty in a file written before the field existed.
    #[serde(default)]
    pub build: String,
    /// The match this replay belongs to, as the durable store knows it (a UUID string) when it was recorded by a live room.
    #[serde(default)]
    pub match_id: Option<String>,
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
                build: BUILD_ID.into(),
                match_id: None,
                config,
                arena: sim.arena().clone(),
                secrets: sim.secrets_for_replay(),
                start,
                ticks: Vec::new(),
                hashes: Vec::new(),
            },
            // Scenario setup happens before the first active step, and is reproduced
            // before its inputs in the same stable order that assigned container/item ids.
            pending: sim
                .containers()
                .iter()
                .map(|c| ReplayInput::WeaponRack {
                    kind: c.kind,
                    at: c.at,
                    weapons: c.items.iter().flatten().map(|i| i.weapon).collect(),
                })
                .collect(),
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
        ReplayInput::WeaponRack {
            kind,
            at,
            ref weapons,
        } => {
            let _ = sim.seed_weapon_container(kind, at, weapons);
        }
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
    /// The replay's `format` tag is not [`REPLAY_FORMAT`] (an older replay, or not one of ours): nothing was run.
    Format {
        found: String,
    },
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
    if r.format != REPLAY_FORMAT {
        return Err(ReplayError::Format {
            found: r.format.clone(),
        });
    }
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
        sim.step_into(&mut events);
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
    // A deserialized replay's map is complete (the shape is checked and the derived tables built while decoding).
    let arena = r.arena.clone();
    match &r.start {
        ReplayStart::Active { placements } => {
            Sim::reset_active(r.config.clone(), arena, r.secrets, placements)
        }
        ReplayStart::Lobby => Sim::new(r.config.clone(), arena, r.secrets),
    }
}
