//! The authoritative simulation of the slice: lobby -> active run -> ended, with movement and collision, the fists melee
//! attack (cooldown, zero-windup player melee, rewound hit test), the damage ledger (PvP factor, mitigation, the PvP hit
//! cap, simultaneous resolution), deaths, leaving (MIA), kill credit, bounty, GV and results.
//!
//! The tick order is the legacy one (`packages/server/src/sim/step.ts`), minus the phases whose mechanics are not in the
//! slice (abilities, target lock, projectiles, signatures, statuses, sudden death, mobs, loot): they are listed in
//! docs/backlog/README.md and must be inserted at their legacy position, never reordered.
//!
//! No I/O, no wall clock, no entropy: time advances only through [`Sim::step`] by exactly [`TICK_MS`], and every secret
//! arrives through [`Secrets`].

use crate::constants::*;
use crate::content::FactionId;
use crate::input::{Command, InputQueue, OrderBudget, Reject};
use crate::math::Vec2;
use crate::pathfind::Pathfinder;
use crate::rng::Mulberry32;
use crate::systems::weapons::release_trigger;

pub use crate::events::Event;
pub use crate::results::{GvBreakdown, GvReason, Outcome, RunResult, WinBonusWhy};
pub(crate) use crate::state::ArenaRt;
pub use crate::state::{
    ActionKind, Packet, PendingAction, Phase, Player, PlayerId, Sample, Status, WeaponRt,
};
pub use crate::statics::{Arena, Secrets, SimConfig};
use crate::systems::ledger::Entry;
pub use crate::systems::melee::in_arc;
use crate::systems::melee::MeleeReq;

/// One match. Clone + serde = checkpoint (the derived map tables and the path scratch are rebuilt on restore).
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Sim {
    pub config: SimConfig,
    pub arena: Arena,
    pub(crate) secrets: Secrets,
    pub tick: u32,
    pub server_time: f64,
    pub phase: Phase,
    pub lobby_ends_at: f64,
    pub raid_started_at: f64,
    pub winner: Option<String>,
    pub(crate) players: Vec<Player>,
    pub(crate) next_id: u32,
    pub(crate) joined: usize,
    pub(crate) spawn_rng: Mulberry32,
    pub(crate) rt: ArenaRt,
    pub(crate) ledger: Vec<Entry>,
    pub(crate) melee: Vec<MeleeReq>,
    pub(crate) rank: Vec<(PlayerId, usize)>,
    pub(crate) stepping: bool,
    /// Events emitted between steps (a leave's result) wait here for the next step: part of a checkpoint.
    pub(crate) events: Vec<Event>,
    #[serde(skip)]
    pub(crate) pathfinder: Pathfinder,
}

/// Placement for [`Sim::reset_active`]: the scenario API used by the headless runner, the parity harness and tests.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Placement {
    pub profile: String,
    pub faction: FactionId,
    pub bot: bool,
    pub at: Vec2,
    /// hp at the start; the faction's max when `None`.
    pub hp: Option<f64>,
}

impl Sim {
    pub fn new(config: SimConfig, arena: Arena, secrets: Secrets) -> Self {
        Self {
            config,
            arena,
            secrets,
            tick: 0,
            server_time: 0.0,
            phase: Phase::Lobby,
            lobby_ends_at: 0.0,
            raid_started_at: 0.0,
            winner: None,
            players: Vec::new(),
            next_id: 1,
            joined: 0,
            spawn_rng: Mulberry32::new(secrets.spawn_seed),
            rt: ArenaRt::default(),
            ledger: Vec::new(),
            melee: Vec::new(),
            rank: Vec::new(),
            stepping: false,
            events: Vec::new(),
            pathfinder: Pathfinder::default(),
        }
    }

    /// Typed reset: a new match whose run is active after its first step, with the players placed as given (the lobby
    /// closes on step 1 exactly as in a live room; placements then override the spawns and reset the rewind history).
    pub fn reset_active(
        config: SimConfig,
        arena: Arena,
        secrets: Secrets,
        placements: &[Placement],
    ) -> Self {
        // The lobby closes on step 1: every human counts toward min_players (bots never close a lobby, as in legacy).
        let humans = placements.iter().filter(|p| !p.bot).count();
        let mut sim = Sim::new(
            SimConfig {
                min_players: humans,
                fill_seconds: 0.0,
                ..config
            },
            arena,
            secrets,
        );
        for p in placements {
            sim.add_player(&p.profile, Some(p.faction), p.bot);
        }
        sim.step();
        let t = sim.server_time;
        for (pl, spec) in sim.players.iter_mut().zip(placements) {
            pl.x = spec.at.x;
            pl.y = spec.at.y;
            pl.facing = 0.0;
            if let Some(hp) = spec.hp {
                pl.hp = hp;
            }
            pl.history = vec![Sample {
                t,
                x: pl.x,
                y: pl.y,
            }];
        }
        sim.take_events();
        sim
    }

    pub fn players(&self) -> &[Player] {
        &self.players
    }
    pub fn player(&self, id: PlayerId) -> Option<&Player> {
        self.players.iter().find(|p| p.id == id)
    }
    pub(crate) fn idx(&self, id: PlayerId) -> Option<usize> {
        self.players.iter().position(|p| p.id == id)
    }
    pub fn secrets_for_replay(&self) -> Secrets {
        self.secrets
    }
    pub fn path_searches(&self) -> u64 {
        self.pathfinder.searches
    }

    pub fn take_events(&mut self) -> Vec<Event> {
        std::mem::take(&mut self.events)
    }

    pub(crate) fn emit(&mut self, e: Event) {
        self.events.push(e);
    }

    /// Joins the lobby (legacy `addPlayer`): faction picked or round robin by join order, fists in hand.
    pub fn add_player(
        &mut self,
        profile: &str,
        faction: Option<FactionId>,
        bot: bool,
    ) -> Option<PlayerId> {
        if self.phase != Phase::Lobby || self.players.len() >= MAX_PLAYERS {
            return None;
        }
        let join_index = self.joined;
        self.joined += 1;
        let faction = faction.unwrap_or_else(|| FactionId::default_for(join_index));
        let hp = crate::content::faction(faction).hp;
        let spot = if self.arena.spawns.is_empty() {
            self.arena.centre()
        } else {
            self.arena.spawns[self.players.len() % self.arena.spawns.len()]
        };
        if self.players.is_empty() {
            self.lobby_ends_at = self.server_time + self.config.lobby_seconds * 1000.0;
        }
        let id = PlayerId(self.next_id);
        self.next_id += 1;
        self.players.push(Player {
            id,
            profile: profile.to_string(),
            name: profile.to_string(),
            bot,
            faction,
            x: spot.x,
            y: spot.y,
            facing: 0.0,
            hp,
            max_hp: hp,
            barrier: 0.0,
            status: Status::Lobby,
            weapon0: None,
            weapon1: None,
            slot: 0,
            ready_at: 0.0,
            draw_started_at: 0.0,
            move_seq: 0,
            kills: 0,
            bounty: 0,
            gv: 0,
            immune_until: 0.0,
            inputs: InputQueue::default(),
            budget: OrderBudget::default(),
            path: Vec::new(),
            history: Vec::new(),
            weapon: WeaponRt::default(),
            killed_by: None,
            killed_by_bot: false,
            gv_parts: GvBreakdown::default(),
            last_hit: None,
            damaged: Vec::new(),
            damaged_humans: Vec::new(),
            dropped_at: None,
            hp_frac_at_tick_start: 1.0,
            down: None,
            resolved: false,
            bot_kills: 0,
            announce: None,
        });
        Some(id)
    }

    /// Queues a validated command for the next step, through the seat's order budget (sim time). The ONLY way any actor's
    /// commands reach the simulation: network clients, scripted bots and policies alike.
    pub fn submit(&mut self, id: PlayerId, cmd: Command) -> Result<(), Reject> {
        let now = self.server_time;
        let Some(i) = self.idx(id) else { return Ok(()) };
        let p = &mut self.players[i];
        if !p.budget.allow(&cmd, now) {
            return Err(Reject::OverBudget);
        }
        p.inputs.push(cmd)
    }

    /// Queues a command with no order budget: the parity harness only (the legacy capture fed the sim directly).
    pub fn submit_unbudgeted(&mut self, id: PlayerId, cmd: Command) -> Result<(), Reject> {
        let Some(i) = self.idx(id) else { return Ok(()) };
        self.players[i].inputs.push(cmd)
    }

    /// A client's connection dropped: the seat is held (reconnect grace is the adapter's job); the time is remembered for
    /// leave credit.
    /// Legacy `markDropped` / `markReconnected`: the drop time is remembered only in a run (leave credit); either way the
    /// queued inputs are dropped (a press that arrived just before the socket closed must not hold the trigger for the whole
    /// grace) and the trigger is released, since the release the client sends will never arrive.
    pub fn mark_dropped(&mut self, id: PlayerId, dropped: bool) {
        let now = self.server_time;
        let active = self.phase == Phase::Active;
        if let Some(i) = self.idx(id) {
            let p = &mut self.players[i];
            if dropped {
                if p.dropped_at.is_none() && active {
                    p.dropped_at = Some(now);
                }
                p.inputs.drain();
            } else {
                p.dropped_at = None;
            }
            release_trigger(p, now);
        }
    }

    /// A player leaves for good (legacy `removePlayer`): in an active run it counts as a death (MIA), resolved at once.
    pub fn remove_player(&mut self, id: PlayerId) {
        let Some(i) = self.idx(id) else { return };
        if self.phase == Phase::Active {
            self.down_player(i, Outcome::Mia);
        }
        self.players.remove(i);
    }

    /// Advances by exactly one fixed step and returns its events.
    pub fn step(&mut self) -> Vec<Event> {
        self.server_time += TICK_MS;
        self.tick += 1;
        self.stepping = true;
        match self.phase {
            Phase::Lobby => self.update_lobby(),
            Phase::Active => self.update_active(),
            Phase::Ended => {
                for p in &mut self.players {
                    p.inputs.drain();
                }
            }
        }
        self.stepping = false;
        self.take_events()
    }
}
