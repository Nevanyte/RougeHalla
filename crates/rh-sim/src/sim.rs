//! The authoritative simulation: lobby -> active run -> ended, movement/collision, item pickup/swap/drop, and melee
//! weapons (cooldowns, zero-windup player melee, rewound hits and specials), the damage ledger (PvP factor, mitigation, hit
//! cap, simultaneous resolution), deaths, leaving (MIA), kill credit, bounty, GV and results.
//!
//! The tick order is the legacy one (`packages/server/src/sim/step.ts`), minus the phases whose mechanics are not in the
//! port (abilities, target lock, projectiles, signatures, statuses, sudden death, mobs and world loot generation): `Pending` rows of
//! the schedule tables (`schedule.rs`, checked against the legacy record by `rh-parity/tests/schedule.rs`) and are
//! ported in place at their legacy position, never reordered.
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
use crate::systems::{self, inputs, Cx};
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
/// Clone + serde = checkpoint `{format, statics, world}` (see `checkpoint.rs`; a decoded `Sim` is complete: the derived
/// map tables and the statics digest are built by deserialization, the scratch starts empty, and neither the scratch
/// nor the path search state is ever serialized).
#[derive(Debug)]
pub struct Sim {
    pub(crate) projection: crate::fx_report::Projection,
    pub(crate) k: MatchStatic,
    pub(crate) w: World,
    pub(crate) s: TickScratch,
    pub(crate) pf: Pathfinder,
}

impl Clone for Sim {
    fn clone(&self) -> Self {
        let k = self.k.clone();
        let mut w = self.w.clone();
        // Vec::clone retains values, not spare capacity. A complete cloned session, like restore, prepares the
        // actual actor domain before its first no-input step and before a later source-membership expansion.
        crate::systems::frost::prepare(&k, &mut w).expect("validated Frost source budget");
        let mut s = self.s.clone();
        s.reserve_actors(w.fighter_count());
        crate::systems::sentenced::prepare(&k, &mut w, &mut s).expect("validated Mark edge budget");
        let mut projection = self.projection.clone();
        projection.prepare_mobs(w.mobs.len());
        Self {
            projection,
            k,
            w,
            s,
            pf: self.pf.clone(),
        }
    }
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
    #[serde(default)]
    pub weapon0: Option<crate::WeaponId>,
    #[serde(default)]
    pub weapon1: Option<crate::WeaponId>,
}

impl Sim {
    /// Current authoritative collision geometry; public static metadata stays on `arena()`.
    pub fn collision_map(&self) -> &crate::TileMap {
        self.k.collision_map(self.w.rt.gates_locked)
    }
    pub(crate) fn collision_view(&self) -> crate::collision::View<'_> {
        self.k.collision_view(self.w.rt.gates_locked)
    }

    pub fn new(config: SimConfig, arena: impl Into<Arc<Arena>>, secrets: Secrets) -> Self {
        Self::try_new(config, arena, secrets).expect("unsupported private foundation configuration")
    }
    /// Fallible admission for the explicitly incomplete mob spawn foundation.
    pub fn try_new(
        config: SimConfig,
        arena: impl Into<Arc<Arena>>,
        secrets: Secrets,
    ) -> Result<Self, &'static str> {
        Self::try_new_with_mob_initializer(
            config,
            arena.into(),
            secrets,
            crate::systems::mobs::initialize,
        )
    }
    /// Exact rules/seed/config constructor for a still-closed profile. Never a live/headless admission path.
    #[cfg(test)]
    pub(crate) fn try_new_unadmitted_kernel_fixture(
        config: SimConfig,
        arena: impl Into<Arc<Arena>>,
        secrets: Secrets,
    ) -> Result<Self, &'static str> {
        Self::try_new_with_mob_initializer(
            config,
            arena.into(),
            secrets,
            crate::systems::mobs::initialize_unadmitted_kernel_fixture,
        )
    }
    fn try_new_with_mob_initializer(
        config: SimConfig,
        arena: Arc<Arena>,
        secrets: Secrets,
        initialize: fn(&mut MatchStatic, &mut World) -> Result<(), &'static str>,
    ) -> Result<Self, &'static str> {
        let mut sim = Self {
            projection: Default::default(),
            k: MatchStatic::new(config, arena, secrets),
            w: World::new(&secrets),
            s: TickScratch::default(),
            pf: Pathfinder::default(),
        };
        crate::terrain::validate_config(&sim.k.config)?;
        crate::abilities::validate_config(&sim.k.config)?;
        crate::systems::arena_rules::validate_config(&sim.k)?;
        crate::systems::initial_loot::initialize(&mut sim.k, &mut sim.w)?;
        initialize(&mut sim.k, &mut sim.w)?;
        crate::systems::sentenced::prepare(&sim.k, &mut sim.w, &mut sim.s)?;
        Ok(sim)
    }
    pub fn mobs(&self) -> &[crate::mob_runtime::Mob] {
        self.w.mobs.as_slice()
    }
    pub fn plague_corpses(&self) -> &[crate::state::PlagueCorpse] {
        &self.w.plague_corpses
    }
    pub fn camp_rosters(&self) -> &[crate::mob_runtime::CampRoster] {
        self.w.mob_runtime.as_ref().map_or(&[], |rt| &rt.camps)
    }

    /// Typed reset: a new match whose run is active after its first step, with the players placed as given (the lobby
    /// closes on step 1 exactly as in a live room; placements then override the spawns and reset the rewind history).
    pub fn reset_active(
        config: SimConfig,
        arena: impl Into<Arc<Arena>>,
        secrets: Secrets,
        placements: &[Placement],
    ) -> Self {
        Self::reset_active_capped(config, arena, secrets, placements, MAX_PLAYERS)
    }

    /// A run with `placements.len()` fighters past the real lobby cap, for scaling measurements only (feature `bench`):
    /// everything else is [`Sim::reset_active`], and [`MAX_PLAYERS`] stays the cap of the real API (`add_player`).
    #[cfg(feature = "bench")]
    pub fn synthetic(
        config: SimConfig,
        arena: impl Into<Arc<Arena>>,
        secrets: Secrets,
        placements: &[Placement],
    ) -> Self {
        Self::reset_active_capped(config, arena, secrets, placements, usize::MAX)
    }

    fn reset_active_capped(
        config: SimConfig,
        arena: impl Into<Arc<Arena>>,
        secrets: Secrets,
        placements: &[Placement],
        cap: usize,
    ) -> Self {
        assert!(
            config
                .lifecycle
                .rules()
                .is_none_or(|r| r.plan_seconds <= 0.),
            "reset_active cannot bypass source planning; start from a lobby"
        );
        // The lobby closes on step 1: every human counts toward min_players (bots never close a lobby, as in legacy).
        let humans = placements.iter().filter(|p| !p.bot).count();
        if config.mob_mode == crate::mob_runtime::MobMode::Pve && config.faction_mode.engagement() {
            assert!(
                placements
                    .iter()
                    .all(|p| crate::systems::mobs::admitted_player_faction(
                        config.faction_mode,
                        p.faction
                    )),
                "unsupported faction in PvE placement"
            );
        }
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
            sim.join(&p.profile, Some(p.faction), p.bot, cap);
        }
        sim.step();
        let t = sim.w.server_time;
        for (pl, spec) in sim.w.players.iter_mut().zip(placements) {
            pl.weapon.weapon0 = spec.weapon0.filter(|w| *w != crate::WeaponId::Fists);
            pl.weapon.weapon1 = spec.weapon1.filter(|w| *w != crate::WeaponId::Fists);
            pl.body.x = spec.at.x;
            pl.body.y = spec.at.y;
            pl.body.facing = 0.0;
            if let Some(hp) = spec.hp {
                pl.vitals.hp = hp;
            }
            pl.body.history.reset(Sample {
                t,
                x: spec.at.x,
                y: spec.at.y,
            });
        }
        sim.take_events();
        // Trusted placement overrides happen after the synthetic bootstrap step. No report
        // from that earlier geometry is a completed observation of this new session.
        sim.projection = crate::fx_report::Projection::empty_at(sim.tick());
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
        self.w.winner.and_then(|id| self.w.roster.name(id))
    }
    pub fn players(&self) -> &[Player] {
        &self.w.players
    }
    pub fn player(&self, id: PlayerId) -> Option<&Player> {
        self.w.players.get(id)
    }
    /// Recorded callsign, including a fighter who has left (for a body label or hit source).
    pub fn player_name(&self, id: PlayerId) -> Option<&str> {
        self.w.roster.name(id)
    }
    pub fn secrets_for_replay(&self) -> Secrets {
        self.k.secrets
    }

    pub fn take_events(&mut self) -> Vec<Event> {
        std::mem::take(&mut self.w.pending_events)
    }

    /// Runs `f` over a [`Cx`] outside a step (a leave): its events wait in the world for the next step, in order.
    pub(crate) fn with_cx<R>(&mut self, f: impl FnOnce(&mut Cx<'_>) -> R) -> R {
        self.s.reserve_actors(self.w.fighter_count());
        let mut ev = std::mem::take(&mut self.w.pending_events);
        let r = f(&mut Cx {
            stats: crate::status_runtime::stats::Inputs::default(),
            #[cfg(feature = "trusted-status-probes")]
            probe: None,
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
        self.join(profile, faction, bot, MAX_PLAYERS)
    }

    /// [`Sim::add_player`] with the lobby cap as a parameter (the real API always passes [`MAX_PLAYERS`]).
    fn join(
        &mut self,
        profile: &str,
        faction: Option<FactionId>,
        bot: bool,
        cap: usize,
    ) -> Option<PlayerId> {
        self.join_body(profile, faction, bot, cap, false)
    }

    /// Closed-profile kernel fixture only. All join operations except the faction admission predicate are shared.
    #[cfg(test)]
    pub(crate) fn add_player_unadmitted_kernel_fixture(
        &mut self,
        profile: &str,
        faction: FactionId,
    ) -> Option<PlayerId> {
        self.join_body(profile, Some(faction), false, MAX_PLAYERS, true)
    }

    fn join_body(
        &mut self,
        profile: &str,
        faction: Option<FactionId>,
        bot: bool,
        cap: usize,
        unadmitted_fixture: bool,
    ) -> Option<PlayerId> {
        if self.w.phase != Phase::Lobby || self.w.players.len() >= cap {
            return None;
        }
        let join_index = self.w.joined;
        let picked_faction = faction;
        let faction = faction.unwrap_or_else(|| {
            if self.k.config.mob_mode == crate::mob_runtime::MobMode::Pve
                && self.k.config.faction_mode.engagement()
            {
                // First-playable availability is the supported basic-faction subset, in source order.
                let choices = FactionId::ALL
                    .into_iter()
                    .filter(|&f| crate::systems::mobs::basic_faction(f));
                choices
                    .clone()
                    .nth(join_index % choices.count())
                    .expect("nonempty basic factions")
            } else {
                FactionId::default_for(join_index)
            }
        });
        if !unadmitted_fixture
            && self.k.config.mob_mode == crate::mob_runtime::MobMode::Pve
            && self.k.config.faction_mode.engagement()
            && !crate::systems::mobs::admitted_player_faction(self.k.config.faction_mode, faction)
        {
            return None;
        }
        self.w.joined = self.w.joined.saturating_add(1);
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
        self.w.roster.push(id, profile);
        self.w
            .actor_history
            .push(crate::mob_runtime::ActorProvenance {
                id,
                origin: crate::mob_runtime::ActorOrigin::Player {
                    join_ordinal: join_index as u32,
                },
            });
        let mut player =
            Player::joining(id, profile, bot, faction, spot, hp, self.k.config.hitboxes);
        player.seat.picked_faction = picked_faction;
        self.w.players.push(player);
        crate::systems::frost::prepare(&self.k, &mut self.w)
            .expect("validated Frost source budget");
        crate::systems::sentenced::prepare(&self.k, &mut self.w, &mut self.s)
            .expect("validated Mark edge budget");
        Some(id)
    }

    /// Queues a validated command for the next step, through the seat's order budget (sim time). The ONLY way any actor's
    /// commands reach the simulation: network clients, scripted bots and policies alike. An actor inside the tick (a
    /// future mob brain) uses `Cx::submit`, which is this same path (`systems::inputs::submit`).
    pub fn submit(&mut self, id: PlayerId, cmd: Command) -> Result<(), Reject> {
        self.with_cx(|cx| cx.submit(id, cmd))
    }

    /// Queues a command with no order budget: the parity harness only (the legacy capture fed the sim directly).
    pub fn submit_unbudgeted(&mut self, id: PlayerId, cmd: Command) -> Result<(), Reject> {
        if cmd.is_train() && !self.k.config.training {
            return Err(Reject::InvalidTrain);
        }
        inputs::submit_unbudgeted(&mut self.w, id, cmd)
    }

    /// A client's connection dropped: the seat is held (reconnect grace is the adapter's job); the time is remembered for
    /// leave credit.
    /// Legacy `markDropped` / `markReconnected`: the drop time is remembered only in a run (leave credit); either way the
    /// queued inputs are dropped (a press that arrived just before the socket closed must not hold the trigger for the whole
    /// grace) and the trigger is released, since the release the client sends will never arrive.
    pub fn mark_dropped(&mut self, id: PlayerId, dropped: bool) {
        crate::lifecycle::dropped(&mut self.w, id, dropped);
    }
    /// Permanent departure, including source planning MIA.
    pub fn remove_player(&mut self, id: PlayerId) {
        self.with_cx(|cx| crate::lifecycle::remove(cx, id));
    }
    /// Administrative void/removal; returns unbanked GV for the durable adapter, never a player command.
    pub fn abandon_player(&mut self, id: PlayerId) -> u32 {
        self.with_cx(|cx| crate::lifecycle::abandon(cx, id))
    }
    pub fn current_plan(&self, id: PlayerId) -> Option<crate::PlanView> {
        crate::systems::planning::plan_for(&self.w, id)
    }
    pub fn plan_ends_at(&self) -> f64 {
        self.w.plan_ends_at
    }

    /// What the schedule ran since the last call, in order: the ported phases, registered systems, action handlers and
    /// hook links (feature `schedule-trace`, for the conformance test; a production build has no trace).
    #[cfg(feature = "schedule-trace")]
    pub fn schedule_trace(&mut self) -> Vec<crate::schedule::TraceEntry> {
        self.w.trace.take()
    }

    /// Forgets the trace without allocating (feature `schedule-trace`): for a run that steps many times and reads none of it.
    #[cfg(feature = "schedule-trace")]
    pub fn clear_schedule_trace(&mut self) {
        self.w.trace.clear();
    }

    /// Advances by exactly one fixed step and returns its events (a thin wrapper over [`Sim::step_into`]).
    pub fn step(&mut self) -> Vec<Event> {
        let mut ev = Vec::new();
        self.step_into(&mut ev);
        ev
    }

    /// Advances by exactly one fixed step, appending its events to `out`: first the events that waited since the last step
    /// (a leave's result), then the step's own, in order. `out` is not cleared, so a caller that loops reuses one buffer
    /// (`out.clear()` between steps) and a steady-state step allocates nothing (`tests/no_alloc.rs`).
    pub fn step_into(&mut self, out: &mut Vec<Event>) {
        self.step_into_with(
            out,
            crate::status_runtime::stats::Inputs::default(),
            #[cfg(feature = "trusted-status-probes")]
            None,
        );
    }
    pub(crate) fn step_into_with(
        &mut self,
        out: &mut Vec<Event>,
        stats: crate::status_runtime::stats::Inputs,
        #[cfg(feature = "trusted-status-probes")] probe: Option<
            &mut crate::status_runtime::probe::HurtRecipe,
        >,
    ) {
        let event_start = out.len();
        self.s.fx.ops.clear();
        self.w.server_time += TICK_MS;
        // A restored checkpoint may legitimately sit one step below the maximum; the tick is the
        // simulation's one bounded counter, so a damaged or terminal state saturates instead of
        // panicking. A checkpoint at the maximum is refused by `check_world`.
        self.w.tick = self.w.tick.saturating_add(1);
        out.append(&mut self.w.pending_events);
        systems::step(&mut Cx {
            stats,
            #[cfg(feature = "trusted-status-probes")]
            probe,
            k: &self.k,
            w: &mut self.w,
            s: &mut self.s,
            ev: out,
            pf: &mut self.pf,
        });
        self.finish_fx_report(&out[event_start..], event_start);
        debug_assert!(
            self.s.is_settled(),
            "tick-local buffers must be empty at the end of a step"
        );
        debug_assert!(
            self.w.pay.is_settled(),
            "the payout queue must be spent and not collecting at the end of a step"
        );
    }
}
