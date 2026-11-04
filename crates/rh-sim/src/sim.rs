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
use crate::content::{
    attack_interval, damage_per_hit, damage_shares, mitigate_shares, paced, player_timings,
    pvp_factor, weapon, DamageShares, FactionId, Shape, WeaponId,
};
use crate::geometry::raycast;
use crate::input::{ActionCmd, Command, InputQueue, MoveCmd, OrderBudget, Reject};
use crate::map::{TileMap, MASK_MELEE};
use crate::math::{angle_between, asin, atan2, hypot, js_round, Vec2};
use crate::pathfind::{plan_path, Pathfinder};
use crate::rng::{action_order, Mulberry32};

/// A player's public entity id: assigned at join, never reused within a match.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub struct PlayerId(pub u32);

/// Everything the core needs that must not be derivable by clients. The live server draws these from the OS CSPRNG; tests
/// and the headless runner derive them from a run seed ([`Secrets::from_seed`]). Never sent to clients or public exports.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Secrets {
    /// Keys the per-tick action order and tie ranks (legacy `orderSalt`).
    pub order_salt: u32,
    /// Seeds the spawn shuffle stream.
    pub spawn_seed: u32,
}

impl Secrets {
    /// Deterministic secrets for tests and headless runs. Not for live matches (a seed in a log would expose them).
    pub fn from_seed(seed: u64) -> Self {
        let lo = seed as u32;
        let hi = (seed >> 32) as u32;
        Self {
            order_salt: crate::rng::hash_seed(lo, hi, 0x4f52_4452, 1),
            spawn_seed: crate::rng::hash_seed(lo, hi, 0x5350_574e, 2),
        }
    }
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SimConfig {
    pub min_players: usize,
    pub lobby_seconds: f64,
    pub fill_seconds: f64,
    /// The PvP factor and hit cap (legacy `pvpRules`). A live run never turns it off.
    pub pvp_rules: bool,
}

impl Default for SimConfig {
    fn default() -> Self {
        Self {
            min_players: 2,
            lobby_seconds: 30.0,
            fill_seconds: 5.0,
            pvp_rules: true,
        }
    }
}

/// The public arena a match is played on: the collision layer and the spawn points.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Arena {
    pub map: TileMap,
    pub spawns: Vec<Vec2>,
}

impl Arena {
    pub fn centre(&self) -> Vec2 {
        let tx = (self.map.w / 2) as i64;
        let ty = (self.map.h / 2) as i64;
        Vec2::new(
            crate::map::tile_to_world_center(tx),
            crate::map::tile_to_world_center(ty),
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Phase {
    Lobby,
    Active,
    Ended,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Status {
    Lobby,
    Alive,
    Dead,
    Mia,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Outcome {
    Won,
    Draw,
    Died,
    Mia,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum WinBonusWhy {
    Starters,
    Opponents,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum GvReason {
    Kill,
    Bounty,
    Win,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GvBreakdown {
    pub kills: u32,
    pub mobs: u32,
    pub bounty: u32,
    pub quest: u32,
    pub win: u32,
    pub total: u32,
}

/// A player's resolved run (legacy `RunResult`): what persistence banks, idempotently, keyed by (match, profile).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RunResult {
    pub outcome: Outcome,
    pub profile: String,
    pub duration_sec: u32,
    pub kills: u32,
    pub killed_by: Option<String>,
    pub killed_by_bot: bool,
    pub place: u32,
    pub players: u32,
    pub gv: GvBreakdown,
    pub win_bonus_withheld: bool,
    pub win_bonus_why: Option<WinBonusWhy>,
}

/// What a step reports. `is_important` events (deaths, results, the end) must reach every client and persistence; the rest
/// are presentation fx a slow client may lose (docs/CONTRACTS.md C-NET-5).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum Event {
    RaidStarted,
    Windup {
        by: PlayerId,
        weapon: WeaponId,
        a: f64,
        ms: f64,
    },
    Swing {
        by: PlayerId,
        weapon: WeaponId,
        x: f64,
        y: f64,
        a: f64,
    },
    Hit {
        victim: PlayerId,
        by: PlayerId,
        amount: f64,
        weapon: WeaponId,
    },
    Stagger {
        id: PlayerId,
    },
    Death {
        id: PlayerId,
        x: f64,
        y: f64,
        by: Option<PlayerId>,
    },
    Gv {
        id: PlayerId,
        amount: u32,
        reason: GvReason,
    },
    Bounty {
        id: PlayerId,
        bounty: u32,
    },
    Victory {
        id: Option<PlayerId>,
        draw: bool,
    },
    RaidEnded,
    Resolved {
        id: PlayerId,
        result: RunResult,
        bot: bool,
    },
}

impl Event {
    pub fn is_important(&self) -> bool {
        matches!(
            self,
            Event::RaidStarted
                | Event::Death { .. }
                | Event::Victory { .. }
                | Event::RaidEnded
                | Event::Resolved { .. }
                | Event::Gv { .. }
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Sample {
    pub t: f64,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ActionKind {
    Swing,
    Cast,
    Draw,
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Packet {
    pub raw: f64,
    pub phys: f64,
    pub magic: f64,
    pub true_: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PendingAction {
    pub kind: ActionKind,
    pub weapon: WeaponId,
    pub started_at: f64,
    pub lands_at: f64,
    pub a: f64,
    pub packet: Packet,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct WeaponRt {
    pub action: Option<PendingAction>,
    pub root_until: f64,
    pub stagger_immune_until: f64,
    pub held: bool,
    pub pressed_at: f64,
    pub buffered_until: f64,
    pub aim: f64,
    pub aim_at: f64,
    pub lag_ms: f64,
}

impl Default for WeaponRt {
    fn default() -> Self {
        Self {
            action: None,
            root_until: 0.0,
            stagger_immune_until: 0.0,
            held: false,
            pressed_at: 0.0,
            buffered_until: 0.0,
            aim: 0.0,
            aim_at: 0.0,
            lag_ms: 0.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Player {
    pub id: PlayerId,
    /// The profile (callsign) the result is banked to; for a bot only its display name.
    pub profile: String,
    pub name: String,
    pub bot: bool,
    pub faction: FactionId,
    pub x: f64,
    pub y: f64,
    pub facing: f64,
    pub hp: f64,
    pub max_hp: f64,
    pub barrier: f64,
    pub status: Status,
    /// Carried items; `None` fights with fists. The slice has no item flow, so these stay `None`.
    pub weapon0: Option<WeaponId>,
    pub weapon1: Option<WeaponId>,
    pub slot: u8,
    pub ready_at: f64,
    pub draw_started_at: f64,
    pub move_seq: u8,
    pub kills: u32,
    pub bounty: u32,
    pub gv: u32,
    pub immune_until: f64,
    // runtime (server-only)
    pub inputs: InputQueue,
    pub budget: OrderBudget,
    pub path: Vec<Vec2>,
    pub history: Vec<Sample>,
    pub weapon: WeaponRt,
    pub killed_by: Option<String>,
    pub killed_by_bot: bool,
    pub gv_parts: GvBreakdown,
    pub last_hit: Option<(PlayerId, f64)>,
    pub damaged: Vec<PlayerId>,
    pub damaged_humans: Vec<PlayerId>,
    pub dropped_at: Option<f64>,
    pub hp_frac_at_tick_start: f64,
    pub down: Option<Outcome>,
    pub resolved: bool,
    pub bot_kills: u32,
    pub announce: Option<(f64, u32)>,
}

impl Player {
    pub fn standing(&self) -> bool {
        self.status == Status::Alive && self.down.is_none() && !self.resolved
    }
    pub fn pos(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
    /// The weapon in hand: the item in the active slot, or fists.
    pub fn active_weapon(&self) -> WeaponId {
        let item = if self.slot == 0 {
            self.weapon0
        } else {
            self.weapon1
        };
        item.unwrap_or(WeaponId::Fists)
    }
    /// Where the fighter was at server time `t` (lerped between ticks, clamped to history; legacy `positionAt`).
    pub fn position_at(&self, t: f64) -> Vec2 {
        let h = &self.history;
        if h.is_empty() || t >= h[h.len() - 1].t {
            return self.pos();
        }
        if t <= h[0].t {
            return Vec2::new(h[0].x, h[0].y);
        }
        let mut i = h.len() - 2;
        while i > 0 && h[i].t > t {
            i -= 1;
        }
        let (a, b) = (h[i], h[i + 1]);
        let k = (t - a.t) / (b.t - a.t);
        Vec2::new(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct MeleeReq {
    attacker: PlayerId,
    weapon: WeaponId,
    a: f64,
    rewind_t: f64,
    packet: Packet,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct Entry {
    victim: PlayerId,
    by: PlayerId,
    by_name: String,
    packet: Packet,
    weapon: WeaponId,
    stagger: bool,
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct ArenaRt {
    started_with: u32,
    started_humans: usize,
    downed_this_tick: Vec<PlayerId>,
    downs_between_ticks: u32,
    bounty_at_tick_start: Vec<(PlayerId, u32)>,
}

/// One match. Clone + serde = checkpoint (the derived map tables and the path scratch are rebuilt on restore).
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Sim {
    pub config: SimConfig,
    pub arena: Arena,
    secrets: Secrets,
    pub tick: u32,
    pub server_time: f64,
    pub phase: Phase,
    pub lobby_ends_at: f64,
    pub raid_started_at: f64,
    pub winner: Option<String>,
    players: Vec<Player>,
    next_id: u32,
    joined: usize,
    spawn_rng: Mulberry32,
    rt: ArenaRt,
    ledger: Vec<Entry>,
    melee: Vec<MeleeReq>,
    rank: Vec<(PlayerId, usize)>,
    stepping: bool,
    #[serde(skip)]
    events: Vec<Event>,
    #[serde(skip)]
    pathfinder: Pathfinder,
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

    /// Restores the derived tables after deserializing a checkpoint.
    pub fn after_restore(&mut self) {
        self.arena.map.rebuild();
        self.pathfinder = Pathfinder::default();
    }

    pub fn players(&self) -> &[Player] {
        &self.players
    }
    pub fn player(&self, id: PlayerId) -> Option<&Player> {
        self.players.iter().find(|p| p.id == id)
    }
    fn idx(&self, id: PlayerId) -> Option<usize> {
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

    fn emit(&mut self, e: Event) {
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
    pub fn mark_dropped(&mut self, id: PlayerId, dropped: bool) {
        let now = self.server_time;
        if let Some(i) = self.idx(id) {
            let p = &mut self.players[i];
            if dropped {
                if p.dropped_at.is_none() {
                    p.dropped_at = Some(now);
                }
            } else {
                p.dropped_at = None;
            }
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

    fn update_lobby(&mut self) {
        for p in &mut self.players {
            p.inputs.drain();
        }
        if self.players.is_empty() {
            return;
        }
        let humans = self.players.iter().filter(|p| !p.bot).count();
        if humans >= self.config.min_players {
            self.lobby_ends_at = self
                .lobby_ends_at
                .min(self.server_time + self.config.fill_seconds * 1000.0);
        }
        if humans >= MAX_PLAYERS || self.server_time >= self.lobby_ends_at {
            self.start_raid();
        }
    }

    fn start_raid(&mut self) {
        self.phase = Phase::Active;
        self.raid_started_at = self.server_time;
        let mut spawns = self.arena.spawns.clone();
        let mut i = spawns.len();
        while i > 1 {
            i -= 1;
            let j = (self.spawn_rng.next_f64() * (i + 1) as f64).floor() as usize;
            spawns.swap(i, j);
        }
        let now = self.server_time;
        for (k, p) in self.players.iter_mut().enumerate() {
            if !spawns.is_empty() {
                let s = spawns[k % spawns.len()];
                p.x = s.x;
                p.y = s.y;
            }
            p.status = Status::Alive;
            p.inputs.drain();
            p.history = vec![Sample {
                t: now,
                x: p.x,
                y: p.y,
            }];
            p.weapon = WeaponRt::default();
            p.ready_at = 0.0;
            p.draw_started_at = 0.0;
        }
        self.rt.started_with = self.players.len() as u32;
        self.rt.started_humans = self.players.iter().filter(|p| !p.bot).count();
        self.rt.downed_this_tick.clear();
        self.rt.downs_between_ticks = 0;
        self.winner = None;
        self.emit(Event::RaidStarted);
    }

    fn update_active(&mut self) {
        let now = self.server_time;
        // markTickStart
        self.rt.bounty_at_tick_start.clear();
        for p in &mut self.players {
            p.hp_frac_at_tick_start = if p.max_hp > 0.0 {
                (p.hp + p.barrier) / p.max_hp
            } else {
                0.0
            };
            self.rt.bounty_at_tick_start.push((p.id, p.bounty));
        }
        self.ledger.clear();
        self.melee.clear();
        let join: Vec<PlayerId> = self.players.iter().map(|p| p.id).collect();
        let order = action_order(self.secrets.order_salt, self.tick, &join);
        self.rank = order.iter().enumerate().map(|(i, id)| (*id, i)).collect();
        for id in &order {
            if let Some(i) = self.idx(*id) {
                self.apply_inputs(i);
            }
        }
        // [abilities] [target locks]  -- not in the slice (docs/backlog)
        self.update_weapons();
        // [afterWeapons]
        let standing: Vec<usize> = (0..self.players.len())
            .filter(|&i| self.players[i].standing())
            .collect();
        let mults: Vec<f64> = standing
            .iter()
            .map(|&i| {
                let m = self.move_multiplier(i);
                if m > 0.0 && m < MOVE_MULT_FLOOR {
                    MOVE_MULT_FLOOR
                } else {
                    m
                }
            })
            .collect();
        let dt = TICK_MS / 1000.0;
        for (k, &i) in standing.iter().enumerate() {
            let p = &mut self.players[i];
            let aiming = p.weapon.aim_at > 0.0 && now - p.weapon.aim_at < AIM_STALE_MS;
            advance_along_path(p, dt, aiming, mults[k]);
        }
        for &i in &standing {
            record_history(&mut self.players[i], now);
        }
        // [projectile sweep, spawns] -- not in the slice
        self.resolve_melee();
        // [beforeDamage: signatures, terrain, statuses] [sudden death] -- not in the slice
        self.apply_ledger();
        // systems
        self.flush_bounty_announcements();
        self.settle();
    }

    fn apply_inputs(&mut self, i: usize) {
        let d = self.players[i].inputs.drain();
        let n = d.actions.len();
        for k in 0..=n {
            if self.players[i].status != Status::Alive {
                return;
            }
            if k == d.move_before.min(n) {
                if let Some(mv) = d.mv {
                    self.apply_move(i, mv);
                }
            }
            if k == d.aim_before.min(n) {
                if let Some(a) = d.aim {
                    self.set_aim(i, a);
                }
            }
            if let Some(cmd) = d.actions.get(k) {
                match *cmd {
                    ActionCmd::Attack { a, t } => self.handle_press(i, a, t),
                    ActionCmd::Release { a, t } => self.handle_release(i, a, t),
                }
            }
        }
    }

    fn apply_move(&mut self, i: usize, mv: MoveCmd) {
        // cancelLockedWindup / dropLock: no target lock in the slice.
        let from = self.players[i].pos();
        let (path, stop, seq) = match mv {
            MoveCmd::Stop { seq } => (Vec::new(), true, seq),
            MoveCmd::Move { x, y, seq } => (
                plan_path(&mut self.pathfinder, &self.arena.map, from, Vec2::new(x, y)),
                false,
                seq,
            ),
        };
        let p = &mut self.players[i];
        if stop || !path.is_empty() {
            p.path = path;
        }
        if let Some(s) = seq {
            p.move_seq = s;
        }
    }

    fn set_aim(&mut self, i: usize, a: f64) {
        let now = self.server_time;
        let p = &mut self.players[i];
        p.weapon.aim = a;
        p.weapon.aim_at = now;
        p.facing = a;
    }

    fn note_lag(&mut self, i: usize, t: Option<f64>) {
        let lag = match t {
            None => TICK_MS,
            Some(t) => self.server_time - t,
        };
        self.players[i].weapon.lag_ms = MAX_REWIND_MS.min(TICK_MS.max(lag));
    }

    fn handle_press(&mut self, i: usize, a: f64, t: Option<f64>) {
        let now = self.server_time;
        self.set_aim(i, a);
        self.note_lag(i, t);
        let w = &mut self.players[i].weapon;
        if !w.held {
            w.pressed_at = now;
        }
        w.held = true;
        w.buffered_until = now + ATTACK_BUFFER_MS;
    }

    fn handle_release(&mut self, i: usize, a: f64, t: Option<f64>) {
        self.set_aim(i, a);
        if t.is_some() {
            self.note_lag(i, t);
        }
        self.players[i].weapon.held = false;
    }

    fn update_weapons(&mut self) {
        for i in 0..self.players.len() {
            if self.players[i].standing() {
                self.step_weapon(i);
            }
        }
    }

    fn step_weapon(&mut self, i: usize) {
        let now = self.server_time;
        let weapon = self.players[i].active_weapon();
        let f = paced(self.players[i].faction);
        let tm = player_timings(weapon, attack_interval(&f, weapon, 1.0));
        if let Some(act) = self.players[i].weapon.action {
            if now + TIE_EPS_MS >= act.lands_at {
                self.land(i, act);
            }
        }
        let p = &self.players[i];
        let wants = p.weapon.held || now <= p.weapon.buffered_until;
        if p.weapon.action.is_none() && wants && now + TIE_EPS_MS >= p.ready_at {
            self.start_attack(i, weapon, tm);
            if tm.windup == 0.0 {
                if let Some(act) = self.players[i].weapon.action {
                    self.land(i, act);
                }
            }
        }
    }

    fn start_attack(&mut self, i: usize, weapon: WeaponId, tm: crate::content::Timings) {
        let now = self.server_time;
        let f = paced(self.players[i].faction);
        let base = damage_per_hit(&f, weapon, 1.0);
        let shares: DamageShares = damage_shares(&f);
        let packet = Packet {
            raw: base,
            phys: shares.phys,
            magic: shares.magic,
            true_: shares.true_,
        };
        let p = &mut self.players[i];
        let start = if p.weapon.pressed_at <= p.ready_at {
            p.ready_at.max(now - TICK_MS)
        } else {
            now
        };
        p.weapon.buffered_until = 0.0;
        let lands_at = start + tm.windup * 1000.0;
        let kind = match (weapon, weapon_shape(weapon)) {
            (_, Shape::Arc { .. }) => ActionKind::Swing,
            (WeaponId::Bow, _) => ActionKind::Draw,
            _ => ActionKind::Cast,
        };
        let aim = p.weapon.aim;
        p.weapon.action = Some(PendingAction {
            kind,
            weapon,
            started_at: start,
            lands_at,
            a: aim,
            packet,
        });
        p.ready_at = start + tm.interval * 1000.0;
        if tm.root > 0.0 {
            p.weapon.root_until = start + tm.root * 1000.0;
        }
        let id = p.id;
        if weapon == WeaponId::Bow {
            p.draw_started_at = start;
        } else {
            self.emit(Event::Windup {
                by: id,
                weapon,
                a: aim,
                ms: (lands_at - now).max(0.0),
            });
        }
    }

    fn land(&mut self, i: usize, act: PendingAction) {
        let now = self.server_time;
        let p = &mut self.players[i];
        p.weapon.action = None;
        match act.kind {
            ActionKind::Swing => {
                let rewind_t = now - MAX_REWIND_MS.min(TICK_MS.max(p.weapon.lag_ms));
                let attacker = p.id;
                self.melee.push(MeleeReq {
                    attacker,
                    weapon: act.weapon,
                    a: act.a,
                    rewind_t,
                    packet: act.packet,
                });
            }
            ActionKind::Cast | ActionKind::Draw => {
                // Projectiles are not in the slice and no ranged weapon can be held in it (no item flow): docs/backlog P-COMBAT-2.
                debug_assert!(false, "ranged attacks are not in the slice");
                p.draw_started_at = 0.0;
            }
        }
    }

    fn move_multiplier(&self, i: usize) -> f64 {
        let p = &self.players[i];
        let now = self.server_time;
        let winding = match p.weapon.action {
            Some(a) => a.kind == ActionKind::Swing || now >= a.lands_at - RANGED_RELEASE_PAUSE_MS,
            None => false,
        };
        if winding || now < p.weapon.root_until {
            0.0
        } else {
            1.0
        }
    }

    fn resolve_melee(&mut self) {
        let reqs = std::mem::take(&mut self.melee);
        if reqs.is_empty() {
            return;
        }
        let bodies: Vec<usize> = (0..self.players.len())
            .filter(|&i| self.players[i].standing())
            .collect();
        for req in reqs {
            let Some(ai) = self.idx(req.attacker) else {
                continue;
            };
            if !self.players[ai].standing() {
                continue;
            }
            let Shape::Arc { reach, half_arc } = weapon_shape(req.weapon) else {
                continue;
            };
            let origin = self.players[ai].position_at(req.rewind_t);
            self.emit(Event::Swing {
                by: req.attacker,
                weapon: req.weapon,
                x: origin.x,
                y: origin.y,
                a: req.a,
            });
            for &ti in &bodies {
                if ti == ai {
                    continue;
                }
                let at = self.players[ti].position_at(req.rewind_t);
                if !in_arc(origin, req.a, reach, half_arc, at, PLAYER_RADIUS) {
                    continue;
                }
                if raycast(&self.arena.map, origin.x, origin.y, at.x, at.y, MASK_MELEE).hit {
                    continue;
                }
                // Shields (block/riposte) need a shield in hand: no item flow in the slice (docs/backlog P-COMBAT-1).
                let victim = self.players[ti].id;
                let by_name = self.players[ai].name.clone();
                self.ledger.push(Entry {
                    victim,
                    by: req.attacker,
                    by_name,
                    packet: req.packet,
                    weapon: req.weapon,
                    stagger: req.weapon == WeaponId::Sword,
                });
            }
        }
    }

    fn rank_of(&self, id: PlayerId) -> usize {
        self.rank
            .iter()
            .find(|(p, _)| *p == id)
            .map(|(_, r)| *r)
            .unwrap_or(usize::MAX)
    }

    /// The damage ledger: every hit of the tick lands at once. Outgoing multipliers are fixed before any victim takes damage,
    /// each victim's hits are mitigated, capped and applied together (ranked by the secret action order for kill credit),
    /// and kill spoils are paid only after every victim took its damage, so no reward decides who survives the pass.
    fn apply_ledger(&mut self) {
        let ledger = std::mem::take(&mut self.ledger);
        if ledger.is_empty() {
            return;
        }
        // Group by victim in order of first appearance (legacy Map insertion order).
        let mut victims: Vec<PlayerId> = Vec::new();
        for e in &ledger {
            if !victims.contains(&e.victim) {
                victims.push(e.victim);
            }
        }
        let mults: Vec<f64> = ledger
            .iter()
            .map(|e| {
                if self.config.pvp_rules && self.idx(e.by).is_some() && self.idx(e.victim).is_some()
                {
                    pvp_factor(0.0)
                } else {
                    1.0
                }
            })
            .collect();
        let mut payouts: Vec<Payout> = Vec::new();
        for v in victims {
            let idxs: Vec<usize> = (0..ledger.len())
                .filter(|&k| ledger[k].victim == v)
                .collect();
            self.apply_victim(v, &ledger, &idxs, &mults, &mut payouts);
        }
        for pay in payouts {
            self.credit_kill(pay.by, pay.victim_bot, pay.bounty);
        }
    }

    fn apply_victim(
        &mut self,
        v: PlayerId,
        ledger: &[Entry],
        idxs: &[usize],
        mults: &[f64],
        payouts: &mut Vec<Payout>,
    ) {
        let Some(vi) = self.idx(v) else { return };
        if !self.players[vi].standing() {
            return;
        }
        let vf = crate::content::faction(self.players[vi].faction);
        let (armor, shield) = (vf.armor.max(0.0), vf.shield);
        let mut amounts: Vec<f64> = idxs
            .iter()
            .map(|&k| {
                let e = &ledger[k];
                let raw = e.packet.raw * mults[k];
                let s = DamageShares {
                    phys: e.packet.phys,
                    magic: e.packet.magic,
                    true_: e.packet.true_,
                };
                mitigate_shares(raw, &s, armor, shield)
            })
            .collect();
        if self.config.pvp_rules {
            let cap = PVP_HIT_CAP_SHARE * self.players[vi].max_hp;
            for a in amounts.iter_mut() {
                if *a > 0.0 && *a > cap {
                    *a = cap;
                }
            }
        }
        let mut order: Vec<usize> = (0..idxs.len()).collect();
        order.sort_by_key(|&j| self.rank_of(ledger[idxs[j]].by));
        let hits: Vec<(f64, PlayerId, String)> = order
            .iter()
            .map(|&j| {
                (
                    amounts[j],
                    ledger[idxs[j]].by,
                    ledger[idxs[j]].by_name.clone(),
                )
            })
            .collect();
        let applied = self.apply_hits(vi, &hits, payouts);
        if !(applied > 0.0) {
            return;
        }
        for (j, &k) in idxs.iter().enumerate() {
            if amounts[j] > 0.0 {
                let e = &ledger[k];
                self.emit(Event::Hit {
                    victim: v,
                    by: e.by,
                    amount: amounts[j],
                    weapon: e.weapon,
                });
            }
        }
        if let Some(vi) = self.idx(v) {
            if self.players[vi].standing()
                && idxs
                    .iter()
                    .enumerate()
                    .any(|(j, &k)| ledger[k].stagger && amounts[j] > 0.0)
            {
                self.stagger(vi);
            }
        }
    }

    /// Legacy `applyHits` for a player victim: the hits land together; the kill goes to the largest rival hit.
    fn apply_hits(
        &mut self,
        vi: usize,
        hits: &[(f64, PlayerId, String)],
        payouts: &mut Vec<Payout>,
    ) -> f64 {
        let now = self.server_time;
        {
            let v = &self.players[vi];
            if !v.standing() || v.hp <= 0.0 || now < v.immune_until {
                return 0.0;
            }
        }
        let victim_id = self.players[vi].id;
        let victim_bot = self.players[vi].bot;
        let mut total = 0.0;
        let mut top: Option<usize> = None;
        let mut top_rival: Option<usize> = None;
        for (h, (amount, by, _)) in hits.iter().enumerate() {
            if !(*amount > 0.0) {
                continue;
            }
            total += amount;
            if top.is_none_or(|t| *amount > hits[t].0) {
                top = Some(h);
            }
            // A source still in the run (not resolved) is an attacker; anyone else is a name only.
            if let Some(si) = self.idx(*by) {
                if !self.players[si].resolved && *by != victim_id {
                    let src = &mut self.players[si];
                    if !src.damaged.contains(&victim_id) {
                        src.damaged.push(victim_id);
                    }
                    if !victim_bot && !src.damaged_humans.contains(&victim_id) {
                        src.damaged_humans.push(victim_id);
                    }
                    if top_rival.is_none_or(|t| *amount > hits[t].0) {
                        top_rival = Some(h);
                    }
                }
            }
        }
        let Some(top) = top else { return 0.0 };
        if let Some(r) = top_rival {
            self.players[vi].last_hit = Some((hits[r].1, now));
        }
        let v = &mut self.players[vi];
        if v.barrier > 0.0 {
            let taken = v.barrier.min(total);
            v.barrier = if v.barrier - taken < 1e-3 {
                0.0
            } else {
                v.barrier - taken
            };
            total -= taken;
        }
        if !(total > 0.0) {
            return 0.0;
        }
        let before = v.hp;
        let unheld = (before - total).max(0.0);
        v.hp = (before - total).max(0.0);
        if v.hp > 0.0 {
            return if v.hp > unheld { total } else { before - v.hp };
        }
        let killer = top_rival.unwrap_or(top);
        let (_, kid, kname) = &hits[killer];
        let killer_idx = self.idx(*kid).filter(|&k| !self.players[k].resolved);
        let killer_bot = killer_idx.map(|k| self.players[k].bot).unwrap_or(false);
        let (vx, vy) = (self.players[vi].x, self.players[vi].y);
        {
            let v = &mut self.players[vi];
            // The killer's display name (legacy: the attacker's name, or the source name of one who already left).
            v.killed_by = Some(kname.clone());
            if killer_bot {
                v.killed_by_bot = true;
            }
        }
        self.emit(Event::Death {
            id: victim_id,
            x: vx,
            y: vy,
            by: killer_idx.map(|_| *kid),
        });
        let credited = match top_rival {
            Some(r) => Some(hits[r].1),
            None => self.recent_rival(vi, now),
        };
        if let Some(c) = credited {
            let bounty = self.owed_bounty(vi);
            payouts.push(Payout {
                by: c,
                victim_bot,
                bounty,
            });
        }
        self.down_player(vi, Outcome::Died);
        before
    }

    fn owed_bounty(&self, vi: usize) -> u32 {
        let v = &self.players[vi];
        if self.stepping {
            self.rt
                .bounty_at_tick_start
                .iter()
                .find(|(id, _)| *id == v.id)
                .map(|(_, b)| *b)
                .unwrap_or(v.bounty)
        } else {
            v.bounty
        }
    }

    fn recent_rival(&self, vi: usize, at: f64) -> Option<PlayerId> {
        let (by, when) = self.players[vi].last_hit?;
        if at - when > KILL_CREDIT_SECONDS * 1000.0 {
            return None;
        }
        let si = self.idx(by)?;
        (!self.players[si].resolved).then_some(by)
    }

    fn down_player(&mut self, vi: usize, outcome: Outcome) {
        if !self.players[vi].standing() {
            return;
        }
        let now = self.server_time;
        let credited = if outcome == Outcome::Mia {
            let at = self.players[vi].dropped_at.unwrap_or(now);
            self.recent_rival(vi, at)
        } else {
            None
        };
        let v = &mut self.players[vi];
        v.down = Some(outcome);
        v.path.clear();
        // releaseTrigger
        v.weapon.held = false;
        v.weapon.buffered_until = 0.0;
        if let Some(a) = v.weapon.action {
            if a.kind != ActionKind::Draw {
                v.weapon.root_until = v.weapon.root_until.min(now);
            }
        }
        v.weapon.action = None;
        v.draw_started_at = 0.0;
        v.status = if outcome == Outcome::Died {
            Status::Dead
        } else {
            Status::Mia
        };
        let victim_bot = v.bot;
        let id = v.id;
        if let Some(c) = credited {
            let bounty = self.players[vi].bounty;
            self.credit_kill(c, victim_bot, bounty);
        }
        if self.stepping {
            self.rt.downed_this_tick.push(id);
            return;
        }
        self.rt.downs_between_ticks += 1;
        let alive = self.players.iter().filter(|p| p.standing()).count() as u32;
        let vi = self.idx(id).expect("still present");
        self.resolve(vi, outcome, alive + 1, 0, None);
    }

    fn credit_kill(&mut self, by: PlayerId, victim_bot: bool, bounty: u32) {
        let Some(bi) = self.idx(by) else { return };
        if self.players[bi].resolved {
            return;
        }
        self.players[bi].kills += 1;
        if victim_bot {
            self.players[bi].bot_kills += 1;
        } else {
            self.credit(bi, GvReason::Kill, GV_KILL);
        }
        if bounty > 0 && !victim_bot {
            self.credit(bi, GvReason::Bounty, bounty);
        }
        self.update_bounty(bi);
    }

    fn credit(&mut self, i: usize, reason: GvReason, amount: u32) {
        let p = &mut self.players[i];
        if p.resolved || amount == 0 {
            return;
        }
        match reason {
            GvReason::Kill => p.gv_parts.kills += amount,
            GvReason::Bounty => p.gv_parts.bounty += amount,
            GvReason::Win => {}
        }
        p.gv = p.gv_parts.kills + p.gv_parts.mobs + p.gv_parts.bounty + p.gv_parts.quest;
        let id = p.id;
        self.emit(Event::Gv { id, amount, reason });
    }

    fn update_bounty(&mut self, i: usize) {
        let p = &mut self.players[i];
        if !p.standing() {
            return;
        }
        let b = crate::content::bounty_for(p.kills as i64 - p.bot_kills as i64);
        if b <= p.bounty {
            return;
        }
        p.bounty = b;
        self.announce_bounty(i);
    }

    fn announce_bounty(&mut self, i: usize) {
        let now = self.server_time;
        let p = &mut self.players[i];
        let (last_at, sent) = p.announce.unwrap_or((f64::NEG_INFINITY, 0));
        if p.bounty <= sent || now - last_at < BOUNTY_ANNOUNCE_MS {
            p.announce = Some((last_at, sent));
            return;
        }
        p.announce = Some((now, p.bounty));
        let (id, bounty) = (p.id, p.bounty);
        self.emit(Event::Bounty { id, bounty });
    }

    fn flush_bounty_announcements(&mut self) {
        for i in 0..self.players.len() {
            let p = &self.players[i];
            if let Some((_, sent)) = p.announce {
                if p.standing() && p.bounty > sent {
                    self.announce_bounty(i);
                }
            }
        }
    }

    fn stagger(&mut self, i: usize) {
        let now = self.server_time;
        let p = &mut self.players[i];
        if now < p.weapon.stagger_immune_until {
            return;
        }
        p.weapon.stagger_immune_until = now + STAGGER_IMMUNITY_SECONDS * 1000.0;
        if let Some(a) = p.weapon.action {
            if a.kind != ActionKind::Draw {
                p.weapon.root_until = p.weapon.root_until.min(now);
                p.weapon.action = None;
                p.draw_started_at = 0.0;
                let id = p.id;
                self.emit(Event::Stagger { id });
            }
        }
    }

    fn settle(&mut self) {
        let downed = std::mem::take(&mut self.rt.downed_this_tick);
        self.rt.downs_between_ticks = 0;
        let alive: Vec<PlayerId> = self
            .players
            .iter()
            .filter(|p| p.standing())
            .map(|p| p.id)
            .collect();
        let contested = self.rt.started_with >= 2;
        if alive.is_empty() || (contested && alive.len() == 1) {
            self.end_run(&alive, &downed, contested);
            return;
        }
        for id in downed {
            if let Some(i) = self.idx(id) {
                let outcome = self.players[i].down.expect("downed");
                self.resolve(i, outcome, alive.len() as u32 + 1, 0, None);
            }
        }
        // [patience timer, coliseum teleport, sudden death] -- not in the slice (docs/backlog P-ARENA-1)
    }

    fn end_run(&mut self, alive: &[PlayerId], downed: &[PlayerId], contested: bool) {
        let mut winners: Vec<PlayerId> = Vec::new();
        if alive.len() == 1 {
            winners = alive.to_vec();
        } else if contested && !downed.is_empty() {
            let best = downed
                .iter()
                .filter_map(|id| self.player(*id))
                .map(|p| p.hp_frac_at_tick_start)
                .fold(f64::NEG_INFINITY, f64::max);
            winners = downed
                .iter()
                .copied()
                .filter(|id| {
                    self.player(*id)
                        .is_some_and(|p| p.hp_frac_at_tick_start == best)
                })
                .collect();
        }
        let draw = winners.len() > 1;
        for id in downed {
            if !winners.contains(id) {
                if let Some(i) = self.idx(*id) {
                    let outcome = self.players[i].down.expect("downed");
                    self.resolve(i, outcome, winners.len() as u32 + 1, 0, None);
                }
            }
        }
        for id in &winners {
            let Some(i) = self.idx(*id) else { continue };
            if draw {
                self.resolve(i, Outcome::Draw, 1, 0, None);
                continue;
            }
            let why = if contested {
                self.withheld_why(i)
            } else {
                Some(WinBonusWhy::Starters)
            };
            self.resolve(
                i,
                Outcome::Won,
                1,
                if why.is_some() { 0 } else { GV_WIN },
                why,
            );
        }
        let winner = if !draw && winners.len() == 1 {
            Some(winners[0])
        } else {
            None
        };
        self.winner = winner
            .and_then(|id| self.player(id))
            .map(|p| p.name.clone());
        self.phase = Phase::Ended;
        self.emit(Event::Victory { id: winner, draw });
        self.emit(Event::RaidEnded);
    }

    fn withheld_why(&self, i: usize) -> Option<WinBonusWhy> {
        if self.rt.started_humans < WIN_BONUS_MIN_PLAYERS {
            return Some(WinBonusWhy::Starters);
        }
        if self.players[i].damaged_humans.len() < WIN_BONUS_MIN_OPPONENTS {
            return Some(WinBonusWhy::Opponents);
        }
        None
    }

    fn resolve(
        &mut self,
        i: usize,
        outcome: Outcome,
        place: u32,
        win: u32,
        why: Option<WinBonusWhy>,
    ) {
        let now = self.server_time;
        let started = self.raid_started_at;
        let players = self.rt.started_with;
        let p = &mut self.players[i];
        if p.resolved {
            return;
        }
        p.resolved = true;
        p.path.clear();
        let g = p.gv_parts;
        let gv = GvBreakdown {
            win,
            total: g.kills + g.mobs + g.bounty + g.quest + win,
            ..g
        };
        let result = RunResult {
            outcome,
            profile: p.profile.clone(),
            duration_sec: if started > 0.0 {
                js_round((now - started) / 1000.0) as u32
            } else {
                0
            },
            kills: p.kills - p.bot_kills,
            killed_by: if outcome == Outcome::Died {
                p.killed_by.clone()
            } else {
                None
            },
            killed_by_bot: outcome == Outcome::Died && p.killed_by_bot,
            place,
            players,
            gv,
            win_bonus_withheld: why.is_some(),
            win_bonus_why: why,
        };
        let (id, bot) = (p.id, p.bot);
        self.emit(Event::Resolved { id, result, bot });
    }

    /// FNV-1a 64 over the authoritative state (every field that can affect a later tick), for determinism and
    /// live/headless equivalence checks. Not a security hash.
    pub fn state_hash(&self) -> u64 {
        let mut h = Fnv64::new();
        h.u64(self.tick as u64);
        h.f64(self.server_time);
        h.u64(self.phase as u64);
        h.f64(self.lobby_ends_at);
        h.f64(self.raid_started_at);
        h.u64(self.spawn_rng.clone().next_u32() as u64);
        for p in &self.players {
            h.u64(p.id.0 as u64);
            h.u64(p.faction as u64);
            for v in [
                p.x,
                p.y,
                p.facing,
                p.hp,
                p.max_hp,
                p.barrier,
                p.ready_at,
                p.draw_started_at,
                p.hp_frac_at_tick_start,
            ] {
                h.f64(v);
            }
            h.u64(p.status as u64);
            h.u64(((p.kills as u64) << 32) | p.bounty as u64);
            h.u64(((p.gv as u64) << 32) | p.move_seq as u64);
            h.u64(p.resolved as u64 | (p.down.map(|o| o as u64 + 1).unwrap_or(0) << 1));
            for w in &p.path {
                h.f64(w.x);
                h.f64(w.y);
            }
            for s in &p.history {
                h.f64(s.t);
                h.f64(s.x);
                h.f64(s.y);
            }
            let w = &p.weapon;
            for v in [
                w.root_until,
                w.stagger_immune_until,
                w.pressed_at,
                w.buffered_until,
                w.aim,
                w.aim_at,
                w.lag_ms,
            ] {
                h.f64(v);
            }
            h.u64(w.held as u64);
            if let Some(a) = w.action {
                h.f64(a.lands_at);
                h.f64(a.a);
            }
        }
        h.finish()
    }
}

struct Payout {
    by: PlayerId,
    victim_bot: bool,
    bounty: u32,
}

fn weapon_shape(w: WeaponId) -> Shape {
    weapon(w).shape
}

/// Is `p` (a disc of radius `r`) inside the arc? Legacy `inArc`.
pub fn in_arc(origin: Vec2, a: f64, reach: f64, half_arc: f64, p: Vec2, r: f64) -> bool {
    let dx = p.x - origin.x;
    let dy = p.y - origin.y;
    let d = hypot(dx, dy);
    if d <= r {
        return true;
    }
    if d > reach + r {
        return false;
    }
    angle_between(atan2(dy, dx), a) <= half_arc + asin((r / d).min(1.0)) + 1e-9
}

/// Walks along the path at PLAYER_SPEED x `speed_mult` for `dt` seconds (legacy `advanceAlongPath`).
fn advance_along_path(p: &mut Player, dt: f64, keep_facing: bool, speed_mult: f64) {
    let mut budget = PLAYER_SPEED * speed_mult * dt;
    while budget > 0.0 && !p.path.is_empty() {
        let target = p.path[0];
        let dx = target.x - p.x;
        let dy = target.y - p.y;
        let dist = hypot(dx, dy);
        if dist <= budget {
            p.x = target.x;
            p.y = target.y;
            budget -= dist;
            p.path.remove(0);
        } else {
            p.x += (dx / dist) * budget;
            p.y += (dy / dist) * budget;
            budget = 0.0;
        }
        if dist > 0.001 && !keep_facing {
            p.facing = atan2(dy, dx);
        }
    }
}

fn record_history(p: &mut Player, now: f64) {
    p.history.push(Sample {
        t: now,
        x: p.x,
        y: p.y,
    });
    let cutoff = now - MAX_REWIND_MS - TICK_MS;
    while p.history.len() > 2 && p.history[0].t < cutoff {
        p.history.remove(0);
    }
}

struct Fnv64(u64);
impl Fnv64 {
    fn new() -> Self {
        Self(0xcbf2_9ce4_8422_2325)
    }
    fn u64(&mut self, v: u64) {
        for b in v.to_le_bytes() {
            self.0 ^= b as u64;
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    fn f64(&mut self, v: f64) {
        self.u64(v.to_bits());
    }
    fn finish(&self) -> u64 {
        self.0
    }
}
