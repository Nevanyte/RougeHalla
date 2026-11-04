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
use crate::input::{Command, Reject};
use crate::math::Vec2;
use crate::pathfind::Pathfinder;
use crate::scratch::TickScratch;
use crate::state::World;
use crate::statics::MatchStatic;
use crate::systems::weapons::release_trigger;
use crate::systems::{self, settle, Cx};
use std::sync::Arc;

pub use crate::events::Event;
pub use crate::results::{GvBreakdown, GvReason, Outcome, RunResult, WinBonusWhy};
pub use crate::state::{
    ActionKind, Packet, PendingAction, Phase, Player, PlayerId, Sample, Status, WeaponRt,
};
pub use crate::statics::{Arena, Secrets, SimConfig};
pub use crate::systems::melee::in_arc;

/// One match: what it is played with ([`MatchStatic`]), what evolves ([`World`]), per-tick working sets
/// ([`TickScratch`], never part of a checkpoint or the hash) and the path search scratch.
/// Clone + serde = checkpoint (the derived map tables and the scratch are rebuilt on restore).
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Sim {
    #[serde(rename = "statics")]
    pub(crate) k: MatchStatic,
    #[serde(rename = "world")]
    pub(crate) w: World,
    #[serde(skip)]
    pub(crate) s: TickScratch,
    #[serde(skip)]
    pub(crate) pf: Pathfinder,
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
    pub fn new(config: SimConfig, arena: impl Into<Arc<Arena>>, secrets: Secrets) -> Self {
        Self {
            k: MatchStatic {
                config,
                arena: arena.into(),
                secrets,
            },
            w: World::new(&secrets),
            s: TickScratch::default(),
            pf: Pathfinder::default(),
        }
    }

    /// Typed reset: a new match whose run is active after its first step, with the players placed as given (the lobby
    /// closes on step 1 exactly as in a live room; placements then override the spawns and reset the rewind history).
    pub fn reset_active(
        config: SimConfig,
        arena: impl Into<Arc<Arena>>,
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
        let t = sim.w.server_time;
        for (pl, spec) in sim.w.players.iter_mut().zip(placements) {
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

    pub fn config(&self) -> &SimConfig {
        &self.k.config
    }
    pub fn arena(&self) -> &Arena {
        &self.k.arena
    }
    /// The shared arena, for holders that keep it beyond the match (a recorder, a room).
    pub fn shared_arena(&self) -> &Arc<Arena> {
        &self.k.arena
    }
    pub fn tick(&self) -> u32 {
        self.w.tick
    }
    pub fn server_time(&self) -> f64 {
        self.w.server_time
    }
    pub fn phase(&self) -> Phase {
        self.w.phase
    }
    pub fn lobby_ends_at(&self) -> f64 {
        self.w.lobby_ends_at
    }
    pub fn raid_started_at(&self) -> f64 {
        self.w.raid_started_at
    }
    /// The winner's display name once the run ended with one.
    pub fn winner(&self) -> Option<&str> {
        self.w.winner.as_deref()
    }
    pub fn players(&self) -> &[Player] {
        &self.w.players
    }
    pub fn player(&self, id: PlayerId) -> Option<&Player> {
        self.w.players.iter().find(|p| p.id == id)
    }
    pub fn secrets_for_replay(&self) -> Secrets {
        self.k.secrets
    }
    pub fn path_searches(&self) -> u64 {
        self.pf.searches
    }

    pub fn take_events(&mut self) -> Vec<Event> {
        std::mem::take(&mut self.w.pending_events)
    }

    /// Runs `f` over a [`Cx`] outside a step (a leave): its events wait in the world for the next step, in order.
    fn with_cx<R>(&mut self, f: impl FnOnce(&mut Cx<'_>) -> R) -> R {
        let mut ev = std::mem::take(&mut self.w.pending_events);
        let r = f(&mut Cx {
            k: &self.k,
            w: &mut self.w,
            s: &mut self.s,
            ev: &mut ev,
            pf: &mut self.pf,
        });
        self.w.pending_events = ev;
        r
    }

    /// Joins the lobby (legacy `addPlayer`): faction picked or round robin by join order, fists in hand.
    pub fn add_player(
        &mut self,
        profile: &str,
        faction: Option<FactionId>,
        bot: bool,
    ) -> Option<PlayerId> {
        if self.w.phase != Phase::Lobby || self.w.players.len() >= MAX_PLAYERS {
            return None;
        }
        let join_index = self.w.joined;
        self.w.joined += 1;
        let faction = faction.unwrap_or_else(|| FactionId::default_for(join_index));
        let hp = crate::content::faction(faction).hp;
        let spot = if self.k.arena.spawns.is_empty() {
            self.k.arena.centre()
        } else {
            self.k.arena.spawns[self.w.players.len() % self.k.arena.spawns.len()]
        };
        if self.w.players.is_empty() {
            self.w.lobby_ends_at = self.w.server_time + self.k.config.lobby_seconds * 1000.0;
        }
        let id = PlayerId(self.w.next_id);
        self.w.next_id += 1;
        self.w
            .players
            .push(Player::joining(id, profile, bot, faction, spot, hp));
        Some(id)
    }

    /// Queues a validated command for the next step, through the seat's order budget (sim time). The ONLY way any actor's
    /// commands reach the simulation: network clients, scripted bots and policies alike.
    pub fn submit(&mut self, id: PlayerId, cmd: Command) -> Result<(), Reject> {
        let now = self.w.server_time;
        let Some(i) = self.w.idx(id) else {
            return Ok(());
        };
        let p = &mut self.w.players[i];
        if !p.budget.allow(&cmd, now) {
            return Err(Reject::OverBudget);
        }
        p.inputs.push(cmd)
    }

    /// Queues a command with no order budget: the parity harness only (the legacy capture fed the sim directly).
    pub fn submit_unbudgeted(&mut self, id: PlayerId, cmd: Command) -> Result<(), Reject> {
        let Some(i) = self.w.idx(id) else {
            return Ok(());
        };
        self.w.players[i].inputs.push(cmd)
    }

    /// A client's connection dropped: the seat is held (reconnect grace is the adapter's job); the time is remembered for
    /// leave credit.
    /// Legacy `markDropped` / `markReconnected`: the drop time is remembered only in a run (leave credit); either way the
    /// queued inputs are dropped (a press that arrived just before the socket closed must not hold the trigger for the whole
    /// grace) and the trigger is released, since the release the client sends will never arrive.
    pub fn mark_dropped(&mut self, id: PlayerId, dropped: bool) {
        let now = self.w.server_time;
        let active = self.w.phase == Phase::Active;
        if let Some(i) = self.w.idx(id) {
            let p = &mut self.w.players[i];
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
        let Some(i) = self.w.idx(id) else { return };
        if self.w.phase == Phase::Active {
            self.with_cx(|cx| settle::down_player(cx.w, cx.ev, None, i, Outcome::Mia));
        }
        self.w.players.remove(i);
    }

    /// Advances by exactly one fixed step and returns its events.
    pub fn step(&mut self) -> Vec<Event> {
        self.w.server_time += TICK_MS;
        self.w.tick += 1;
        // The step's event log starts with the events that waited since the last step (a leave's result).
        let mut ev = std::mem::take(&mut self.w.pending_events);
        systems::step(&mut Cx {
            k: &self.k,
            w: &mut self.w,
            s: &mut self.s,
            ev: &mut ev,
            pf: &mut self.pf,
        });
        debug_assert!(
            self.s.is_settled(),
            "tick-local buffers must be empty at the end of a step"
        );
        ev
    }
}
