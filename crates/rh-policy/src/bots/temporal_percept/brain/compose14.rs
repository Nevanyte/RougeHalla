//! The accepted-frame composer (P-BOT-BRAIN-LIVE-1, reconciled in P-BOT-BRAIN-RECONCILE-1): `Frame14` -> the source
//! `Percept`, and the seat-side fence ([`SeatComposer14`]) a `BrainBot` drives it through.
//!
//! The composer sees only an accepted `Frame14` (the bytes a human client gets), its own retained ring of earlier
//! accepted samples and the static setup. It never sees `Sim`, `World` or any server-only state. A fact the seat cannot
//! see is the source's `undefined` (never a plausible default); a missing required group refuses the frame.
//!
//! Source: `packages/server/src/bots/brain/perception.ts` (`perceive`, `selfView`, `fighterSeen`, `mobSeen`,
//! `seeContainers`, `seeChests`, `seeCamps`, `seeFields`) and `frames.ts` (`FrameRing.compose`: `viewT`, interpolation at
//! the view time, `velocity`, `isCentral`, `tintNearestFoe`, `deliver`, `windowExtras`). Degraded fair profile
//! (owner-approved 2026-11-11; docs/DEVIATIONS.md DEV-026), as P-BOT-BRAIN-LIVE-1 section 6 names it:
//! - always `undefined`: `self.immuneUntil`, `hud.alive`, `hud.minPlayers`, `minimap.t`,
//!   `fighters[].drawStartedAt`, `mobs[].drawStartedAt`, `projectiles[].{id,vx,vy,x0,y0,t0,range}`;
//! - derived, not unpublished (DEV-026, owner confirmation pending): `self.mobKills` counts this seat's own accepted
//!   `Death` events of regional mobs (and elites) credited to it while the dead row was delivered (an under-count when a
//!   credited death is out of sight; `undefined` would make every farm score NaN);
//! - the private plan deal (`kind: "private"`, `type: "plan"`) is an immediate event when the delivered plan group
//!   changes (source `input.privates`, perception.ts:672-679);
//! - `hud.winner` is legacy's `state.winner` (arena.ts:91, :466): `""` until the seat accepts `MatchEnded`, then the
//!   winner's roster name (`""` on a draw);
//! - `undefined` when its own condition holds: `self.attackTarget` (a held lock whose target is redacted), `self.name`
//!   and `fighters[].{name,bot}` (no roster row), `mobs[].type` (no type code), `mobs[].name` (a quest giver or a
//!   zombie: the name or the zombie's owner is not on the wire), `containers[].weapon` (contents unknown, the source's own
//!   `undefined`), `events[].weapon` of every hit (the dealing weapon is not on the wire), `events[].name` of a player
//!   with no roster row or of a zombie;
//! - absent: minimap dots (`[]`), projectile launch/end events, Wish cast events, the owner notices
//!   (potion/cannon/pickup/chest refusals, wind emblem, camp cleared) and `extras.skills` (source-only);
//! - `extras.wish` is the delivered Wish slot with its `def` built from the public catalog (`bots::wish::WISHES` and
//!   `rh_sim::abilities::definition`), its `rank` `undefined` (not on the wire; source `rankOf` reads it as 1).
//!
//! NPC references are per-sample (no cross-frame join), so a mob's velocity is the source's `0` for "no earlier sample"
//! and a mob is drawn where the newest sample has it, not interpolated at `viewT` like a player. The camera is always the
//! newest self position: frames.ts:137-142 keeps it (and the scene) at the old spot until render time reaches a teleport
//! cut, which needs the pre-cut scene retained (not done; both are proposed deviations for piece 3).

use super::percept::Percept;
use super::room_paths::with_gates;
use super::trace::BVal;
use crate::bots::fair_percept14::{FairPerceptRing14, Refusal14 as FenceRefusal, Required14};
use crate::bots::memory_prefix::MAX_RECORDS;
use crate::bots::perception::{npc_key, player_key, reward_option_id, CHEST_PANEL_RANGE};
use crate::bots::types::{TierId, BOT_VIEW_HALF_H, BOT_VIEW_HALF_W};
use crate::bots::view::Features;
use crate::bots::view::{field_in_view, in_view, FieldInView};
use crate::delivery::frame::{status as wire_status, weapon as wire_weapon};
use crate::delivery::{AcceptedFrame14, Frame14};
use crate::InputRefusal;
use rh_protocol::{WireActor, WireEvent, WireFx, WireOwnerLock, WirePlan, WirePropKind, WireSelf};
use rh_sim::mapgen::certify::source_hypot as hypot;
use rh_sim::math::js_round;
use rh_sim::mob_catalog::{mob_name, mob_type_by_id, MobTypeId};
use rh_sim::{Arena, FactionId, PlayerId, Status, TileMap, Vec2, WeaponId};
use std::sync::Arc;

/// frames.ts:18 `VELOCITY_MS`: velocity is read off two samples this far apart.
const VELOCITY_MS: f64 = 100.;
/// frames.ts:20 `KEEP_EXTRA_MS`: samples kept this long beyond the world delay.
const KEEP_EXTRA_MS: f64 = 200.;
/// frames.ts:24 `MAX_FRAMES`.
const MAX_SAMPLES: usize = 128;
/// frames.ts:26 `MAX_QUEUED`: undelivered world events kept at most.
const MAX_QUEUED: usize = 4096;
/// shared `TELEPORT_DISTANCE`: a jump this long is a cut, never a slide.
const TELEPORT_DISTANCE: f64 = 200.;
/// shared `MATCHUP_RANGE` and the full-strength range of the matchup tint.
const MATCHUP_RANGE: f64 = 450.;
const MATCHUP_FULL_RANGE: f64 = 150.;
/// types.ts:285 `FRAME_MARGIN`: the perceive box is the view plus this.
const FRAME_MARGIN: f64 = 64.;
/// perception.ts:200 `MIN_HEAL_SHOWN`.
const MIN_HEAL_SHOWN: f64 = 1.;
/// Effect bits (`Actor14::targetable`, `bots::wish::EFFECT_HIDDEN`).
const EFFECT_UNTARGETABLE: u16 = 128;
const EFFECT_HIDDEN: u16 = crate::bots::wish::EFFECT_HIDDEN;
/// shared abilities.ts `FIELD_KINDS` and `ABILITY_IDS` (the wire codes are their indices).
const FIELD_KINDS: [&str; 3] = ["zone", "cloud", "trail"];
const ABILITY_IDS: [&str; 5] = ["freeze", "swarm", "trial", "blaze", "lastStand"];
/// The HUD stat codes of a camp's per-kill reward (`rh_protocol::HUD_STAT_COUNT` order).
const HUD_STATS: [&str; 9] = [
    "offense",
    "soulOffense",
    "damage",
    "attackSpeed",
    "lifeSteal",
    "health",
    "defense",
    "soulDefense",
    "moveSpeed",
];

/// Static, public setup bound once per seat (never read from a live world).
#[derive(Clone, Debug)]
pub(crate) struct Setup14 {
    /// The match's public map (from `MatchStart::arena`).
    pub(crate) arena: Arc<Arena>,
    /// The declared source feature verdicts for this room (message types in source order).
    pub(crate) features: Features,
    /// Source `worldDelayMs`: `viewT = now - world_delay_ms`. Zero composes the present.
    pub(crate) world_delay_ms: f64,
    /// Source `attentionCentral` share of the view box (`isCentral`).
    pub(crate) attention_central: f64,
}

/// The delays a `BrainBot` composes with: the interpolation delay a client renders at (`INTERP_DELAY_MS`,
/// packages/shared/src/constants.ts:18) and no extra self lag. Legacy live fill bots added the simulated line latency
/// (`BotManager.ts:351`, 30 ms by default); a seat here has the real transport's latency instead, so it adds none
/// (`BotClient.ts:321` is the same shape: `selfDelayMs: 0, worldDelayMs: INTERP_DELAY_MS`).
pub(crate) const BRAIN_WORLD_DELAY_MS: f64 = 100.;
pub(crate) const BRAIN_SELF_DELAY_MS: f64 = 0.;

impl Setup14 {
    /// The setup a `BrainBot` seat uses: only the public map, the room's feature verdicts and the tier's attention share,
    /// with the pinned delays. The server's spawn points are dropped. The map keeps its layers: the composer reads only the
    /// camp ids (`extras.camps[].id`) and the coliseum gate tiles (`withGates`) from them, both drawn by a client.
    pub(crate) fn public(arena: &Arena, features: Features, attention_central: f64) -> Self {
        Self {
            arena: Arc::new(Arena {
                map: arena.map.clone(),
                spawns: Vec::new(),
            }),
            features,
            world_delay_ms: BRAIN_WORLD_DELAY_MS,
            attention_central,
        }
    }
}

/// Why a frame cannot become a percept. The composer is atomic: a refusal leaves its ring untouched.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Refusal14 {
    OwnerMissing,
    InventoryMissing,
    OwnerCombatMissing,
    BuildMissing,
    /// The Arena group (raid start, patience, gates, coliseum) is absent, e.g. the Off arena profile.
    ArenaMissing,
    /// The sample is not later than the last composed one in this session.
    Clock,
}

/// A camp ward the viewer owns, for the Vision filter (source `wardOwner === selfId && wardExpiresAt > now`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct WardSight14 {
    /// Index into the frame's camp rows (`map.camps` order).
    pub(crate) camp: usize,
    pub(crate) expires_at: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Composed14 {
    pub(crate) percept: Percept,
    /// Only the viewer's own wards (`WireWard::yours`); another player's ward is not a vision source for this seat.
    pub(crate) wards: Vec<WardSight14>,
    /// Source `FrameRing.compose` returns no percept while the oldest retained sample is later than `viewT`
    /// (frames.ts:131): with a world delay the ring has to fill first. The sample is still pushed; a caller must not
    /// tick the Brain on an uncovered composition.
    pub(crate) covered: bool,
    /// The references a command decided from this composition may name: only what this accepted frame delivered.
    pub(crate) refs: Refs,
}

/// The references one composition's commands may resolve (`emit_command`): the delivered actor rows, and the container
/// and reward-chest keys of this frame mapped to the handles this frame delivered for those rows. A key not here (an
/// older frame's, a remembered one) resolves to nothing, never to a guess.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Refs {
    pub(crate) actors: Vec<(String, PlayerId)>,
    pub(crate) pickups: Vec<(String, u32)>,
    pub(crate) chests: Vec<(String, u32)>,
}

impl crate::bots::bot::CommandRefs for Refs {
    fn actor(&self, id: &str) -> Option<PlayerId> {
        self.actors
            .iter()
            .find(|(key, _)| key == id)
            .map(|(_, actor)| *actor)
    }
    fn pickup(&self, id: &str) -> Option<u32> {
        self.pickups
            .iter()
            .find(|(key, _)| key == id)
            .map(|(_, handle)| *handle)
    }
    fn chest(&self, id: &str) -> Option<u32> {
        self.chests
            .iter()
            .find(|(key, _)| key == id)
            .map(|(_, handle)| *handle)
    }
}

/// One retained accepted sample: only what the ring needs (positions of the owner and of the delivered player rows,
/// whether the coliseum teleport happened in it). NPC rows are not retained: their references are per-sample.
#[derive(Clone, Debug)]
struct Sample {
    time: f64,
    me: Vec2,
    /// Delivered player rows, by ascending player id.
    players: Vec<(u32, Vec2)>,
    teleport: bool,
}

/// How a world event is windowed at delivery (frames.ts `deliver`).
#[derive(Clone, Copy, Debug, PartialEq)]
enum Lane {
    /// Hit and block: dropped off the window, the attacker masked to what is drawn.
    Masked,
    /// A player's death: off the window it is announced by name only.
    PlayerDeath,
    /// A regional mob's death: only on the window.
    MobDeath,
    /// An elite's death: announced with its killer.
    EliteDeath,
    /// Everything else with a point: only on the window.
    Plain,
}

/// A source record under construction, own-key order preserved.
type Record = Vec<(&'static str, BVal)>;

#[derive(Clone, Debug)]
struct Queued {
    time: f64,
    at: Option<Vec2>,
    lane: Lane,
    /// The source event record in its own key order (`kind`, `t`, `at`, ...).
    record: Record,
    /// The victim of a death (pending deaths keep a body drawn).
    death_of: Option<String>,
}

/// A row drawn in this sample (self or delivered actor): its key, where and what it holds.
struct Seen {
    id: u32,
    key: String,
    at: Vec2,
    weapon: Option<WeaponId>,
    npc: bool,
    elite: bool,
}

pub(crate) struct Composer14 {
    setup: Setup14,
    /// The map with the coliseum gates closed (`withGates`; the open map when it has no gates).
    locked: TileMap,
    samples: Vec<Sample>,
    world: Vec<Queued>,
    /// Immediate events (toasts, results) of compositions the ring did not cover yet: source `takeImmediate` runs only
    /// when `compose` returns a percept (frames.ts:131 returns before it), so they wait for the first covered one.
    held: Vec<BVal>,
    /// `self.mobKills`, derived: this seat's own accepted regional-mob deaths credited to it (DEV-026).
    mob_kills: u32,
    /// The last delivered plan group: the private plan deal is sent when it changes.
    last_plan: Option<WirePlan>,
    /// `hud.winner` (arena.ts:91, :466): `""` until this seat accepts `MatchEnded`, then the winner's roster name (`""` on
    /// a draw or without a roster row).
    winner: String,
}

/// The groups a composition reads, all present (the composer's preflight).
struct Groups<'f> {
    me: &'f WireSelf,
    inventory: &'f rh_protocol::WireInventory,
    combat: &'f rh_protocol::WireOwnerCombat,
    build: &'f rh_protocol::WireBuild,
    arena: &'f rh_protocol::WireArena,
}

impl Composer14 {
    pub(crate) fn new(setup: Setup14) -> Self {
        let locked = with_gates(&setup.arena.map);
        Self {
            setup,
            locked,
            samples: Vec::new(),
            world: Vec::new(),
            held: Vec::new(),
            mob_kills: 0,
            last_plan: None,
            winner: String::new(),
        }
    }

    /// Forget every retained sample (a new session or match).
    pub(crate) fn reset(&mut self) {
        self.samples.clear();
        self.world.clear();
        self.held.clear();
        self.mob_kills = 0;
        self.last_plan = None;
        self.winner.clear();
    }

    /// The composer's whole refusal set, without changing anything (the seat's `check_input`).
    pub(crate) fn check(&self, frame: &Frame14) -> Result<(), Refusal14> {
        self.preflight(frame).map(drop)
    }

    /// Every required group, then the clock. Nothing after it may fail, so a refusal changes nothing.
    fn preflight<'f>(&self, frame: &'f Frame14) -> Result<Groups<'f>, Refusal14> {
        let me = frame.owner.as_ref().ok_or(Refusal14::OwnerMissing)?;
        let inventory = frame
            .collections
            .inventory
            .as_ref()
            .ok_or(Refusal14::InventoryMissing)?;
        let combat = frame
            .owner_combat
            .as_ref()
            .ok_or(Refusal14::OwnerCombatMissing)?;
        let build = frame
            .collections
            .build
            .as_ref()
            .ok_or(Refusal14::BuildMissing)?;
        let arena = frame
            .collections
            .arena
            .as_ref()
            .ok_or(Refusal14::ArenaMissing)?;
        if self
            .samples
            .last()
            .is_some_and(|s| frame.source_time <= s.time)
        {
            return Err(Refusal14::Clock);
        }
        Ok(Groups {
            me,
            inventory,
            combat,
            build,
            arena,
        })
    }

    pub(crate) fn compose(&mut self, frame: &Frame14) -> Result<Composed14, Refusal14> {
        let Groups {
            me,
            inventory,
            combat,
            build,
            arena,
        } = self.preflight(frame)?;
        let now = frame.source_time;

        let features = &self.setup.features;
        let status_bits = features.status_effects;
        let active = frame.phase == 1;
        let me_key = player_key(PlayerId(me.id));
        let me_at = Vec2::new(f64::from(me.x), f64::from(me.y));
        let me_alive = wire_status(me.status) == Status::Alive;
        let shown = |a: &WireActor| {
            let bits = if status_bits { a.effects } else { 0 };
            a.id != me.id && bits & EFFECT_HIDDEN == 0
        };

        // ---- the ring: push this sample (frames.ts push), prune, then compose at viewT.
        let mut players: Vec<(u32, Vec2)> = frame
            .actors
            .iter()
            .filter(|a| a.kind == 0 && shown(a))
            .map(|a| (a.id, actor_at(a)))
            .collect();
        players.sort_by_key(|(id, _)| *id);
        self.samples.push(Sample {
            time: now,
            me: me_at,
            players,
            teleport: frame
                .fx
                .iter()
                .any(|b| b.fx.iter().any(|f| matches!(f, WireFx::Teleport))),
        });
        let keep = self.setup.world_delay_ms + KEEP_EXTRA_MS;
        let cutoff = now - keep;
        while self.samples.len() > 2 && self.samples[1].time <= cutoff {
            self.samples.remove(0);
        }
        while self.samples.len() > MAX_SAMPLES {
            self.samples.remove(0);
        }

        // What this sample draws (perceive's box), for the events it carries.
        let mut seen: Vec<Seen> = vec![Seen {
            id: me.id,
            key: me_key.clone(),
            at: me_at,
            weapon: wire_weapon(me.weapon),
            npc: false,
            elite: false,
        }];
        for a in frame.actors.iter().filter(|a| shown(a)) {
            let at = actor_at(a);
            if !in_view(me_at.x, me_at.y, at.x, at.y, FRAME_MARGIN) {
                continue;
            }
            seen.push(Seen {
                id: a.id,
                key: actor_key(a),
                at,
                weapon: wire_weapon(a.weapon),
                npc: a.kind != 0,
                elite: mob_def(a).is_some_and(|d| d.elite),
            });
        }
        let roster_name = |id: u32| {
            frame
                .collections
                .roster
                .iter()
                .find(|r| r.id == id)
                .map(|r| r.name.clone())
        };
        let (queued, immediate) = sample_events(frame, now, &seen, &roster_name);
        self.world.extend(queued);
        if self.world.len() > MAX_QUEUED {
            let excess = self.world.len() - MAX_QUEUED;
            self.world.drain(..excess);
        }

        let view_t = now - self.setup.world_delay_ms;
        // frames.ts:131: no percept while the oldest retained sample is later than the view time.
        let covered = self.samples[0].time <= view_t;
        let latest = self.samples.len() - 1;
        let eye = me_at;
        let sight = if arena.gates_locked {
            &self.locked
        } else {
            &self.setup.arena.map
        };
        let los =
            |at: Vec2| rh_sim::geometry::has_line_of_sight(sight, eye, at, rh_sim::map::MASK_SIGHT);
        let central = self.setup.attention_central;
        let is_central = |at: Vec2| {
            (at.x - eye.x).abs() <= central * BOT_VIEW_HALF_W
                && (at.y - eye.y).abs() <= central * BOT_VIEW_HALF_H
        };

        let mut due = Vec::new();
        let mut keep_queued = Vec::new();
        for q in self.world.drain(..) {
            if q.time <= view_t {
                due.push(q);
            } else {
                keep_queued.push(q);
            }
        }
        self.world = keep_queued;
        let pending_deaths: Vec<&str> = self
            .world
            .iter()
            .filter_map(|q| q.death_of.as_deref())
            .collect();

        let now_bracket = self.bracket(view_t);
        let prev_t = view_t - VELOCITY_MS;
        let prev_bracket = self.bracket(prev_t);
        let prev_self = self
            .frame_at(self.samples[latest].time - VELOCITY_MS)
            .map(|i| self.samples[i].me);
        let cut = self.teleport_between(prev_t, view_t);

        // ---- fighters (fighterSeen + compose), by source id order.
        let mut actors: Vec<&WireActor> = frame.actors.iter().filter(|a| shown(a)).collect();
        actors.sort_by_key(|a| actor_key(a));
        let mut fighters = Vec::new();
        let mut drawn: Vec<(String, Vec2)> = Vec::new();
        let mut fighter_rows: Vec<FighterRow> = Vec::new();
        for a in actors.iter().filter(|a| a.kind == 0) {
            let key = actor_key(a);
            let status = wire_status(a.status);
            if !matches!(status, Status::Alive | Status::Lobby)
                && !pending_deaths.contains(&key.as_str())
            {
                continue;
            }
            let at = self
                .sample(now_bracket, a.id)
                .unwrap_or_else(|| actor_at(a));
            if !in_view(eye.x, eye.y, at.x, at.y, 0.) {
                continue;
            }
            let v = self.velocity(prev_bracket, prev_self, a.id, at, cut);
            let bits = if status_bits { a.effects } else { 0 };
            let row = FighterRow {
                faction: faction_of(a.faction),
                in_hand: in_hand(a.weapon),
                alive: status == Status::Alive,
                dist: hypot(at.x - eye.x, at.y - eye.y),
                los: los(at),
            };
            let roster = frame.collections.roster.iter().find(|r| r.id == a.id);
            fighters.push(vec![
                ("id", BVal::text(key.clone())),
                (
                    "name",
                    roster.map_or(BVal::Undefined, |r| BVal::text(r.name.clone())),
                ),
                ("bot", roster.map_or(BVal::Undefined, |r| BVal::flag(r.bot))),
                ("x", BVal::num(at.x)),
                ("y", BVal::num(at.y)),
                ("facing", BVal::num(f64::from(a.facing))),
                ("status", BVal::text(status_name(status))),
                ("hpFrac", BVal::num(f64::from(a.hp_pct) / 100.)),
                ("barrierFrac", BVal::num(f64::from(a.barrier_pct) / 100.)),
                ("faction", opt_name(row.faction.map(FactionId::as_str))),
                ("inHand", opt_name(row.in_hand.map(WeaponId::as_str))),
                ("drawStartedAt", BVal::Undefined),
                ("bounty", BVal::num(f64::from(a.bounty))),
                (
                    "immune",
                    BVal::flag(a.flags & rh_protocol::ACTOR_FLAG_TELEPORT_IMMUNE != 0),
                ),
                ("sig", BVal::num(if active { f64::from(a.sig) } else { 0. })),
                (
                    "brand",
                    BVal::num(if active { f64::from(a.brand) } else { 0. }),
                ),
                ("targetable", BVal::flag(bits & EFFECT_UNTARGETABLE == 0)),
                ("vx", BVal::num(v.x)),
                ("vy", BVal::num(v.y)),
                ("dist", BVal::num(row.dist)),
                ("los", BVal::flag(row.los)),
                ("tint", BVal::num(0.)),
                ("central", BVal::flag(is_central(at))),
            ]);
            fighter_rows.push(row);
            drawn.push((key, at));
        }

        // ---- mobs (mobSeen + compose). A dead row stays drawn only when its death is in this very sample (fade).
        let died_now: Vec<u32> = frame
            .events
            .iter()
            .flat_map(|b| &b.events)
            .filter_map(|e| match e {
                WireEvent::Death { id, .. } => Some(*id),
                _ => None,
            })
            .collect();
        let mut mobs = Vec::new();
        let mut mob_rows: Vec<FighterRow> = Vec::new();
        for a in actors.iter().filter(|a| a.kind != 0) {
            let status = wire_status(a.status);
            if status != Status::Alive && !died_now.contains(&a.id) {
                continue;
            }
            let at = actor_at(a);
            if !in_view(eye.x, eye.y, at.x, at.y, 0.) {
                continue;
            }
            let key = actor_key(a);
            let def = mob_def(a);
            let faction = faction_of(a.faction);
            let (kind, name) = match a.kind {
                // plagueZombies.ts:61: kind "zombie", named "<owner>'s Zombie"; the owner is not on the wire.
                2 => ("zombie", None),
                1 => (
                    if def.is_some_and(|d| d.elite) {
                        "elite"
                    } else {
                        "mob"
                    },
                    def.map(|d| d.name)
                        .or_else(|| faction.map(|f| mob_name(f, false))),
                ),
                3 => (
                    "dummy",
                    Some(if wire_weapon(a.weapon) == Some(WeaponId::Shield) {
                        "Shield dummy"
                    } else {
                        "Dummy"
                    }),
                ),
                _ => ("npc", None),
            };
            let row = FighterRow {
                faction,
                in_hand: in_hand(a.weapon),
                alive: status == Status::Alive,
                dist: hypot(at.x - eye.x, at.y - eye.y),
                los: los(at),
            };
            mobs.push(vec![
                ("id", BVal::text(key.clone())),
                ("kind", BVal::text(kind)),
                ("name", name.map_or(BVal::Undefined, BVal::text)),
                (
                    "type",
                    def.map_or(BVal::Undefined, |d| BVal::text(d.id.as_str())),
                ),
                ("faction", opt_name(faction.map(FactionId::as_str))),
                ("x", BVal::num(at.x)),
                ("y", BVal::num(at.y)),
                ("facing", BVal::num(f64::from(a.facing))),
                ("status", BVal::text(status_name(status))),
                ("hpFrac", BVal::num(f64::from(a.hp_pct) / 100.)),
                ("inHand", opt_name(row.in_hand.map(WeaponId::as_str))),
                ("drawStartedAt", BVal::Undefined),
                ("sig", BVal::num(if active { f64::from(a.sig) } else { 0. })),
                (
                    "brand",
                    BVal::num(if active { f64::from(a.brand) } else { 0. }),
                ),
                ("vx", BVal::num(0.)),
                ("vy", BVal::num(0.)),
                ("dist", BVal::num(row.dist)),
                ("los", BVal::flag(row.los)),
                ("central", BVal::flag(is_central(at))),
            ]);
            mob_rows.push(row);
            drawn.push((key, at));
        }

        // ---- tintNearestFoe (frames.ts:379-395).
        let my_weapons = inventory.slots.map(|w| w.and_then(wire_weapon));
        let my_slot = usize::from(inventory.active_slot == 1);
        let my_faction = faction_of(me.faction);
        if active && me_alive && my_faction.is_some() {
            if let Some((index, dist)) = nearest_foe(&fighter_rows, &mob_rows) {
                let score = my_weapons[my_slot]
                    .zip(fighter_rows[index].in_hand)
                    .map_or(0., |(mine, theirs)| {
                        f64::from(crate::bots::mob_hunt::weapon_edge(mine, theirs))
                    });
                let tint = if dist >= MATCHUP_RANGE || score == 0. {
                    0.
                } else {
                    let fade = if dist <= MATCHUP_FULL_RANGE {
                        1.
                    } else {
                        (MATCHUP_RANGE - dist) / (MATCHUP_RANGE - MATCHUP_FULL_RANGE)
                    };
                    (score.clamp(-2., 2.) / 2.) * fade
                };
                if let Some(slot) = fighters[index].iter_mut().find(|(k, _)| *k == "tint") {
                    slot.1 = BVal::num(tint);
                }
            }
        }

        let visible = |id: u32| -> Option<String> {
            if id == me.id {
                return Some(me_key.clone());
            }
            let key = key_of(id);
            drawn.iter().any(|(k, _)| *k == key).then_some(key)
        };

        // ---- containers (seeContainers as the server's focus draws it), by key.
        // ---- the references this composition's commands may name (every delivered actor row, drawn or not).
        let mut refs = Refs {
            actors: frame
                .actors
                .iter()
                .map(|a| (actor_key(a), PlayerId(a.id)))
                .collect(),
            ..Refs::default()
        };
        let focus = frame.collections.props.focus.as_ref();
        let mut containers: Vec<(String, BVal)> = Vec::new();
        for prop in &frame.collections.props.rows {
            let (kind, tag) = match prop.kind {
                WirePropKind::Ground(w) => ("ground", format!("g{w}")),
                WirePropKind::Chest { .. } => ("chest", "c".to_owned()),
                WirePropKind::Body { .. } => ("body", "b".to_owned()),
                WirePropKind::Cannon { .. } => ("cannon", "n".to_owned()),
                WirePropKind::Corpse { .. } => ("corpse", "x".to_owned()),
                WirePropKind::WindEmblem => ("consumable", "w".to_owned()),
                WirePropKind::QuestItem { .. } => continue,
            };
            let at = Vec2::new(f64::from(prop.x) / 8., f64::from(prop.y) / 8.);
            if !in_view(eye.x, eye.y, at.x, at.y, 0.) {
                continue;
            }
            let key = format!("c{}_{}_{tag}", prop.x, prop.y);
            refs.pickups.push((key.clone(), prop.handle.get()));
            let interactable = focus.is_some_and(|f| f.handle == prop.handle);
            let named = |code: u8| opt_name(in_hand(code).map(WeaponId::as_str));
            let (closed, weapon) = if interactable {
                let w = match prop.kind {
                    WirePropKind::Ground(w) => Some(w),
                    _ => focus.and_then(|f| f.body_hint),
                };
                (true, w.map_or(BVal::Undefined, named))
            } else {
                match &prop.kind {
                    WirePropKind::Ground(w) => match in_hand(*w) {
                        Some(w) => (true, BVal::text(w.as_str())),
                        None => (false, BVal::Null),
                    },
                    WirePropKind::Body { .. } => {
                        // perception.ts:729: reach is range plus a movement-mask line (a hand does not go
                        // through a fence); a body out of reach reads unknown, never empty.
                        let reach = hypot(at.x - me_at.x, at.y - me_at.y)
                            <= rh_sim::constants::INTERACT_RANGE
                            && rh_sim::geometry::has_line_of_sight(
                                sight,
                                me_at,
                                at,
                                rh_sim::map::MASK_MOVE,
                            );
                        if me_alive && reach && focus.is_none() {
                            (false, BVal::Null)
                        } else {
                            (true, BVal::Undefined)
                        }
                    }
                    WirePropKind::Chest { open: false } => (true, BVal::Undefined),
                    _ => (false, BVal::Null),
                }
            };
            let label = match &prop.kind {
                WirePropKind::Body { label } => label.clone(),
                _ => String::new(),
            };
            containers.push((
                key.clone(),
                BVal::obj([
                    ("id", BVal::text(key)),
                    ("kind", BVal::text(kind)),
                    ("x", BVal::num(at.x)),
                    ("y", BVal::num(at.y)),
                    ("label", BVal::text(label)),
                    ("closed", BVal::flag(closed)),
                    ("weapon", weapon),
                    ("interactable", BVal::flag(interactable)),
                    ("dist", BVal::num(hypot(at.x - eye.x, at.y - eye.y))),
                ]),
            ));
        }
        containers.sort_by(|a, b| a.0.cmp(&b.0));

        // ---- projectiles: the current point only; the course is not published.
        let mut projectiles = Vec::new();
        for p in &frame.collections.projectiles {
            let at = Vec2::new(f64::from(p.x) / 8., f64::from(p.y) / 8.);
            if !in_view(eye.x, eye.y, at.x, at.y, 0.) {
                continue;
            }
            projectiles.push(BVal::obj([
                ("id", BVal::Undefined),
                (
                    "kind",
                    BVal::text(if p.kind == 1 { "ball" } else { "arrow" }),
                ),
                ("x", BVal::num(at.x)),
                ("y", BVal::num(at.y)),
                ("vx", BVal::Undefined),
                ("vy", BVal::Undefined),
                ("x0", BVal::Undefined),
                ("y0", BVal::Undefined),
                ("t0", BVal::Undefined),
                ("range", BVal::Undefined),
                (
                    "from",
                    p.owner.and_then(visible).map_or(BVal::Null, BVal::text),
                ),
            ]));
        }

        // ---- events: due world events windowed (deliver), then the immediate lane.
        let mut visible_keys = vec![me_key.clone()];
        visible_keys.extend(drawn.iter().map(|(k, _)| k.clone()));
        let mut events = Vec::new();
        for q in due {
            if let Some(ev) = deliver(q, eye, &visible_keys) {
                events.push(ev);
            }
        }
        let mut immediate = immediate;
        // The private plan deal, once per change of the delivered plan group (source `input.privates`).
        if frame.collections.plan != self.last_plan {
            if let Some(plan) = frame.collections.plan.as_ref() {
                immediate.push(plan_event(plan, now));
            }
            self.last_plan.clone_from(&frame.collections.plan);
        }
        if !self.held.is_empty() {
            immediate.splice(0..0, std::mem::take(&mut self.held));
        }
        if !covered {
            // Kept for the first covered composition, as the source's immediate queue keeps them (bounded alike).
            self.held = immediate;
            if self.held.len() > MAX_QUEUED {
                let excess = self.held.len() - MAX_QUEUED;
                self.held.drain(..excess);
            }
            immediate = Vec::new();
        }
        let has_toast = immediate
            .iter()
            .any(|e: &BVal| e.get("kind").and_then(BVal::as_str) == Some("toast"));
        events.extend(immediate);

        // ---- extras, in the declared key order (wish, skills, chests, camps, effects, fields).
        let mut extras: Record = Vec::new();
        if features.wishes {
            if let Some(wish) = me.wish.as_ref().and_then(|w| wish_record(w, me.effects)) {
                extras.push(("wish", wish));
            }
        }
        if features.chests {
            let mut chests: Vec<(String, BVal)> = frame
                .collections
                .reward_chests
                .iter()
                .map(|c| {
                    let at = Vec2::new(f64::from(c.x) / 8., f64::from(c.y) / 8.);
                    let key = format!("r{}_{}_{}", c.x, c.y, c.expires_at.to_bits());
                    refs.chests.push((key.clone(), c.handle.get()));
                    // perception.ts:790: the panel opens within range AND in sight of the chest.
                    let open = me_alive
                        && c.can_choose
                        && hypot(at.x - me_at.x, at.y - me_at.y) <= CHEST_PANEL_RANGE
                        && rh_sim::geometry::has_line_of_sight(
                            sight,
                            me_at,
                            at,
                            rh_sim::map::MASK_SIGHT,
                        );
                    let options = if open {
                        BVal::arr(
                            c.options
                                .iter()
                                .map(|o| BVal::text(reward_option_id(&o.id))),
                        )
                    } else {
                        BVal::Null
                    };
                    let taken_by = if open {
                        BVal::arr(c.options.iter().map(|o| {
                            BVal::text(match o.taken_by {
                                Some(by) if by == me.id => me_key.clone(),
                                Some(_) => "?".to_owned(),
                                None if o.taken => "?".to_owned(),
                                None => String::new(),
                            })
                        }))
                    } else {
                        BVal::arr([])
                    };
                    (
                        key.clone(),
                        BVal::obj([
                            ("id", BVal::text(key)),
                            ("x", BVal::num(at.x)),
                            ("y", BVal::num(at.y)),
                            ("expiresAt", BVal::num(c.expires_at)),
                            ("options", options),
                            ("takenBy", taken_by),
                            ("picked", BVal::flag(c.picked)),
                        ]),
                    )
                })
                .collect();
            chests.sort_by(|a, b| a.0.cmp(&b.0));
            extras.push(("chests", BVal::arr(chests.into_iter().map(|(_, v)| v))));
        }
        let map_camps = self.setup.arena.map.layers().map(|l| &l.data().camps);
        if features.camps {
            let camps = frame.collections.camps.iter().enumerate().map(|(i, c)| {
                let id = map_camps
                    .and_then(|camps| camps.get(i))
                    .map_or_else(|| format!("camp{i}"), |d| d.id.clone());
                BVal::obj([
                    ("respawnAt", BVal::num(c.respawn_at)),
                    ("index", BVal::num(i as f64)),
                    ("id", BVal::text(id)),
                    (
                        "type",
                        BVal::text(
                            MobTypeId::ALL
                                .get(usize::from(c.mob_type))
                                .map_or("", |t| t.as_str()),
                        ),
                    ),
                    (
                        "reward",
                        BVal::text(c.reward.map_or("", |r| {
                            HUD_STATS.get(usize::from(r.stat)).copied().unwrap_or("")
                        })),
                    ),
                    ("alive", BVal::num(f64::from(c.alive))),
                    (
                        "state",
                        BVal::num(if matches!(c.state, 1 | 2) {
                            f64::from(c.state)
                        } else {
                            0.
                        }),
                    ),
                ])
            });
            extras.push(("camps", BVal::arr(camps)));
        }
        if status_bits {
            let mut bits = vec![(me_key.clone(), BVal::num(f64::from(me.effects)))];
            for (key, _) in &drawn {
                if let Some(a) = frame.actors.iter().find(|a| actor_key(a) == *key) {
                    bits.push((key.clone(), BVal::num(f64::from(a.effects))));
                }
            }
            extras.push(("effects", BVal::Obj(bits)));
        }
        if features.fields {
            let mut fields: Vec<(String, BVal)> = Vec::new();
            for f in &frame.collections.fields {
                let kind = name_or_code(&FIELD_KINDS, f.kind);
                let shape = FieldInView {
                    kind: kind.clone(),
                    x: f64::from(f.x),
                    y: f64::from(f.y),
                    x2: f64::from(f.x2),
                    y2: f64::from(f.y2),
                    r: f64::from(f.r),
                };
                if !field_in_view(eye.x, eye.y, &shape, 0.) {
                    continue;
                }
                // No runtime field id is published: the key is the field's public cue (kind, ability, start, place).
                let key = format!(
                    "f{}_{}_{}_{}_{}",
                    f.kind,
                    f.ability,
                    f.started_at.to_bits(),
                    f.x.to_bits(),
                    f.y.to_bits()
                );
                fields.push((
                    key.clone(),
                    BVal::obj([
                        ("id", BVal::text(key)),
                        ("kind", BVal::text(kind)),
                        ("ability", BVal::text(name_or_code(&ABILITY_IDS, f.ability))),
                        ("x", BVal::num(shape.x)),
                        ("y", BVal::num(shape.y)),
                        ("x2", BVal::num(shape.x2)),
                        ("y2", BVal::num(shape.y2)),
                        ("r", BVal::num(shape.r)),
                        (
                            "owner",
                            f.owner.and_then(visible).map_or(BVal::Null, BVal::text),
                        ),
                        ("endsAt", BVal::num(f.ends_at)),
                    ]),
                ));
            }
            fields.sort_by(|a, b| a.0.cmp(&b.0));
            extras.push(("fields", BVal::arr(fields.into_iter().map(|(_, v)| v))));
        }

        let wards = frame
            .collections
            .camps
            .iter()
            .enumerate()
            .filter_map(|(camp, c)| {
                c.ward
                    .filter(|w| w.yours && w.expires_at > now)
                    .map(|w| WardSight14 {
                        camp,
                        expires_at: w.expires_at,
                    })
            })
            .collect();

        // ---- hud.winner: legacy's `state.winner`, learned from the seat's own accepted `MatchEnded`.
        for event in frame.events.iter().flat_map(|b| &b.events) {
            if let WireEvent::MatchEnded { winner, draw } = event {
                self.winner = winner
                    .filter(|_| !*draw)
                    .and_then(&roster_name)
                    .unwrap_or_default();
            }
        }

        // ---- self.mobKills, derived (DEV-026): the seat's own accepted deaths of delivered regional mobs credited to it.
        for event in frame.events.iter().flat_map(|b| &b.events) {
            if let WireEvent::Death { id, by } = event {
                if *by == Some(me.id) && frame.actors.iter().any(|a| a.id == *id && a.kind == 1) {
                    self.mob_kills = self.mob_kills.saturating_add(1);
                }
            }
        }

        // ---- self (selfView) and hud.
        let attack_target = match combat.lock {
            WireOwnerLock::Clear => BVal::Null,
            WireOwnerLock::Held { target: Some(id) } => frame
                .actors
                .iter()
                .find(|a| a.id == id)
                .map_or(BVal::Undefined, |a| BVal::text(actor_key(a))),
            WireOwnerLock::Held { target: None } => BVal::Undefined,
        };
        let self_record = self_record(
            me,
            &me_key,
            roster_name(me.id),
            &my_weapons,
            my_slot,
            attack_target.clone(),
            f64::from(self.mob_kills),
            combat,
            build,
        );
        let phase = match frame.phase {
            0 => "lobby",
            1 => "active",
            2 => "ended",
            _ => "planning",
        };
        let hud = BVal::obj([
            ("phase", BVal::text(phase)),
            ("training", BVal::flag(frame.training)),
            ("lobbyEndsAt", BVal::num(arena.lobby_ends_at)),
            ("raidStartedAt", BVal::num(arena.raid_started_at)),
            // A typed absent deadline is the source's "no patience clock" (schema default 0), never Infinity.
            (
                "patienceEndsAt",
                BVal::num(arena.patience_ends_at.unwrap_or(0.)),
            ),
            ("suddenDeathAt", BVal::num(arena.sudden_death_at)),
            ("inColiseum", BVal::flag(arena.in_coliseum)),
            ("gatesLocked", BVal::flag(arena.gates_locked)),
            ("startedWith", BVal::num(f64::from(arena.started_with))),
            ("alive", BVal::Undefined),
            (
                "playerCount",
                BVal::num(frame.collections.roster.len() as f64),
            ),
            ("minPlayers", BVal::Undefined),
            ("winner", BVal::text(self.winner.clone())),
        ]);
        let features_record = BVal::obj([
            (
                "messageTypes",
                BVal::arr(features.message_types.iter().map(|m| BVal::text(m.clone()))),
            ),
            ("wishes", BVal::flag(features.wishes)),
            ("statusEffects", BVal::flag(features.status_effects)),
            ("fields", BVal::flag(features.fields)),
            ("planning", BVal::flag(features.planning)),
            ("chests", BVal::flag(features.chests)),
            ("skills", BVal::flag(features.skills)),
            ("relics", BVal::flag(features.relics)),
            ("camps", BVal::flag(features.camps)),
            ("hazards", BVal::flag(features.hazards)),
        ]);
        let raw = BVal::obj([
            ("now", BVal::num(now)),
            ("viewT", BVal::num(view_t)),
            ("self", self_record),
            ("hud", hud),
            ("fighters", BVal::arr(fighters.into_iter().map(BVal::obj))),
            ("mobs", BVal::arr(mobs.into_iter().map(BVal::obj))),
            (
                "containers",
                BVal::arr(containers.into_iter().map(|(_, v)| v)),
            ),
            ("projectiles", BVal::Arr(projectiles)),
            (
                "minimap",
                BVal::obj([
                    ("t", BVal::Undefined),
                    ("mobs", BVal::arr([])),
                    ("gatesLocked", BVal::flag(arena.gates_locked)),
                ]),
            ),
            ("events", BVal::Arr(events)),
            ("extras", BVal::obj(extras)),
            ("features", features_record),
        ]);
        let percept = Percept {
            now,
            view_time: view_t,
            me_x: me_at.x,
            me_y: me_at.y,
            me_status: status_name(wire_status(me.status)).to_owned(),
            me_faction: my_faction,
            me_weapons: my_weapons,
            me_draw_started_at: f64::from(combat.draw_started_at),
            // Typed header: only a visible target is a key. A redacted held lock is `undefined` in the record.
            me_attack_target: attack_target.as_str().map(str::to_owned),
            // brain.ts:218 `attackTarget !== null`: a held lock is held whether or not its target is on the wire.
            me_attack_held: matches!(combat.lock, WireOwnerLock::Held { .. }),
            hud_phase: phase.to_owned(),
            hud_gates_locked: arena.gates_locked,
            hud_sudden_death_at: arena.sudden_death_at,
            has_toast,
            features: features.clone(),
            raw,
        };
        Ok(Composed14 {
            percept,
            wards,
            covered,
            refs,
        })
    }
}

/// This sample's events (perceive `observe` + the immediate lane): the world events (queued until the view time reaches
/// them) and the immediate ones (toasts, results), each at the sample's source time.
fn sample_events(
    frame: &Frame14,
    t: f64,
    seen: &[Seen],
    roster_name: &dyn Fn(u32) -> Option<String>,
) -> (Vec<Queued>, Vec<BVal>) {
    let mut world = Vec::new();
    let mut immediate = Vec::new();
    let find = |id: u32| seen.iter().find(|s| s.id == id);
    let seen_key = |id: u32| find(id).map_or(BVal::Null, |s| BVal::text(s.key.clone()));
    let name_of = |id: u32| roster_name(id).map_or(BVal::Undefined, BVal::text);
    let mut push = |at: Option<Vec2>, lane: Lane, death_of: Option<String>, rest: Record| {
        let mut rest = rest.into_iter();
        let mut record: Record = rest.next().into_iter().collect();
        record.push(("t", BVal::num(t)));
        record.push(("at", at.map_or(BVal::Null, point)));
        record.extend(rest);
        world.push(Queued {
            time: t,
            at,
            lane,
            record,
            death_of,
        });
    };
    {
        for fx in frame.fx.iter().flat_map(|b| &b.fx) {
            match *fx {
                WireFx::Swing { by, weapon, a, .. } => {
                    if let Some(s) = find(by) {
                        push(
                            Some(s.at),
                            Lane::Plain,
                            None,
                            vec![
                                ("kind", BVal::text("swing")),
                                ("by", BVal::text(s.key.clone())),
                                ("weapon", weapon_name(weapon)),
                                ("a", BVal::num(f64::from(a))),
                            ],
                        );
                    }
                }
                WireFx::Hit {
                    victim, by, amount, ..
                } => hit(
                    &find,
                    &seen_key,
                    (victim, by, f64::from(amount), None),
                    &mut push,
                ),
                WireFx::SigHit {
                    victim,
                    by,
                    kind,
                    amount,
                } => {
                    let sig = match kind {
                        rh_protocol::HIT_KIND_BURN => "burn",
                        rh_protocol::HIT_KIND_DISEASE => "disease",
                        rh_protocol::HIT_KIND_BACKLASH => "backlash",
                        rh_protocol::HIT_KIND_MARK => "mark",
                        // Bleed and ability chunks have no source `hit` spelling here: absent.
                        _ => continue,
                    };
                    hit(
                        &find,
                        &seen_key,
                        (victim, by, f64::from(amount), Some(sig)),
                        &mut push,
                    );
                }
                WireFx::Block { id, by, weapon } => {
                    if let Some(s) = find(id) {
                        push(
                            Some(s.at),
                            Lane::Masked,
                            None,
                            vec![
                                ("kind", BVal::text("block")),
                                ("id", BVal::text(s.key.clone())),
                                ("by", seen_key(by)),
                                ("weapon", weapon_name(weapon)),
                            ],
                        );
                    }
                }
                WireFx::Stagger { id } | WireFx::Cancel { id } => {
                    if let Some(s) = find(id) {
                        let kind = if matches!(fx, WireFx::Stagger { .. }) {
                            "stagger"
                        } else {
                            "cancel"
                        };
                        push(
                            Some(s.at),
                            Lane::Plain,
                            None,
                            vec![
                                ("kind", BVal::text(kind)),
                                ("id", BVal::text(s.key.clone())),
                            ],
                        );
                    }
                }
                WireFx::Heal { id, amount } => {
                    let amount = f64::from(amount);
                    if let Some(s) = find(id).filter(|_| amount >= MIN_HEAL_SHOWN) {
                        push(
                            Some(s.at),
                            Lane::Plain,
                            None,
                            vec![
                                ("kind", BVal::text("heal")),
                                ("id", BVal::text(s.key.clone())),
                                ("amount", BVal::num(js_round(amount))),
                            ],
                        );
                    }
                }
                WireFx::Teleport => push(
                    None,
                    Lane::Plain,
                    None,
                    vec![("kind", BVal::text("teleport"))],
                ),
                // perception.ts:457-460: a windup shows where its attacker is drawn (protocol 16 carries it).
                WireFx::Windup { by, weapon, a, ms } => {
                    if let Some(s) = find(by) {
                        push(
                            Some(s.at),
                            Lane::Plain,
                            None,
                            vec![
                                ("kind", BVal::text("windup")),
                                ("by", BVal::text(s.key.clone())),
                                ("weapon", weapon_name(weapon)),
                                ("a", BVal::num(f64::from(a))),
                                ("ms", BVal::num(f64::from(ms))),
                            ],
                        );
                    }
                }
                // Projectile launch/end and Wish cast cues are not composed in this profile: absent.
                WireFx::WishStarted { .. }
                | WireFx::WishLanded { .. }
                | WireFx::WishEnded { .. } => {}
            }
        }
        for event in frame.events.iter().flat_map(|b| &b.events) {
            match event {
                WireEvent::Death { id, by } => {
                    let key = key_of(*id);
                    let row = find(*id);
                    let by_key = by.map_or(BVal::Null, &seen_key);
                    if *id < NPC_BASE {
                        push(
                            row.map(|s| s.at),
                            Lane::PlayerDeath,
                            Some(key.clone()),
                            vec![
                                ("kind", BVal::text("death")),
                                ("id", BVal::text(key)),
                                ("name", name_of(*id)),
                                ("by", if row.is_some() { by_key } else { BVal::Null }),
                                ("mob", BVal::flag(false)),
                            ],
                        );
                    } else if frame.actors.iter().any(|a| a.id == *id && a.kind == 2) {
                        // perception.ts:496-503 (deliver frames.ts:435): a zombie is not a regional mob, so its death
                        // takes the announced lane; where and by whom only while it is drawn.
                        push(
                            row.map(|s| s.at),
                            Lane::PlayerDeath,
                            Some(key.clone()),
                            vec![
                                ("kind", BVal::text("death")),
                                ("id", BVal::text(key)),
                                ("name", BVal::Undefined),
                                ("by", if row.is_some() { by_key } else { BVal::Null }),
                                ("mob", BVal::flag(true)),
                            ],
                        );
                    } else if let Some(s) = row.filter(|s| s.npc) {
                        let elite = s.elite;
                        let name = frame
                            .actors
                            .iter()
                            .find(|a| a.id == *id)
                            .and_then(|a| mob_def(a).map(|d| d.name))
                            .map_or(BVal::Undefined, BVal::text);
                        push(
                            Some(s.at),
                            if elite {
                                Lane::EliteDeath
                            } else {
                                Lane::MobDeath
                            },
                            Some(key.clone()),
                            vec![
                                ("kind", BVal::text("death")),
                                ("id", BVal::text(key)),
                                ("name", name),
                                (
                                    "by",
                                    if elite {
                                        by.map_or(BVal::Null, |b| BVal::text(key_of(b)))
                                    } else {
                                        by_key
                                    },
                                ),
                                ("mob", BVal::flag(true)),
                            ],
                        );
                    }
                }
                WireEvent::Bounty { id, bounty } => push(
                    None,
                    Lane::Plain,
                    None,
                    vec![
                        ("kind", BVal::text("bounty")),
                        ("id", BVal::text(key_of(*id))),
                        ("name", name_of(*id)),
                        ("bounty", BVal::num(f64::from(*bounty))),
                    ],
                ),
                WireEvent::MatchEnded { winner, draw } => push(
                    None,
                    Lane::Plain,
                    None,
                    vec![
                        ("kind", BVal::text("victory")),
                        ("id", winner.map_or(BVal::Null, |w| BVal::text(key_of(w)))),
                        ("name", winner.map_or(BVal::Null, name_of)),
                        ("draw", BVal::flag(*draw)),
                    ],
                ),
                WireEvent::Toast { text } => immediate.push(BVal::obj([
                    ("kind", BVal::text("toast")),
                    ("t", BVal::num(t)),
                    ("at", BVal::Null),
                    ("text", BVal::text(text.clone())),
                ])),
                WireEvent::Result(r) => immediate.push(BVal::obj([
                    ("kind", BVal::text("result")),
                    ("t", BVal::num(t)),
                    ("at", BVal::Null),
                    ("result", result_record(r)),
                ])),
                // Owner notices (potion, cannon, pickup/chest refusals, wind emblem) and the camp-clear cue: absent.
                WireEvent::PotionNotice { .. }
                | WireEvent::CannonNotice { .. }
                | WireEvent::PickupRefused { .. }
                | WireEvent::ChestRefused { .. }
                | WireEvent::WindEmblem
                | WireEvent::CampCleared { .. } => {}
            }
        }
    }
    (world, immediate)
}

/// perception.ts `observe` for a hit: shown where its victim is drawn; the attacker named only when drawn.
fn hit<'s>(
    find: &dyn Fn(u32) -> Option<&'s Seen>,
    seen_key: &dyn Fn(u32) -> BVal,
    (victim, by, amount, sig): (u32, u32, f64, Option<&'static str>),
    push: &mut dyn FnMut(Option<Vec2>, Lane, Option<String>, Record),
) {
    let Some(s) = find(victim) else {
        return;
    };
    let dot = matches!(sig, Some("burn" | "disease"));
    let shown = if !dot && amount > 0. {
        js_round(amount).max(1.)
    } else {
        js_round(amount)
    };
    // The weapon that dealt a hit is not on the wire (an arrow outlives a swap, card hooks and damage over time have
    // none): unknown, never inferred from what the attacker holds now.
    let weapon = BVal::Undefined;
    push(
        Some(s.at),
        Lane::Masked,
        None,
        vec![
            ("kind", BVal::text("hit")),
            ("id", BVal::text(s.key.clone())),
            ("by", seen_key(by)),
            ("amount", BVal::num(shown)),
            ("weapon", weapon),
            ("sig", sig.map_or(BVal::Null, BVal::text)),
        ],
    );
}

impl Composer14 {
    /// The newest retained sample at or before `t`.
    fn frame_at(&self, t: f64) -> Option<usize> {
        self.samples.iter().rposition(|s| s.time <= t)
    }

    /// A teleport sample in (from, to].
    fn teleport_between(&self, from: f64, to: f64) -> bool {
        self.samples
            .iter()
            .any(|s| s.teleport && s.time > from && s.time <= to)
    }

    fn bracket(&self, t: f64) -> Option<Bracket> {
        let a = self.frame_at(t)?;
        Some(match self.samples.get(a + 1) {
            None => Bracket {
                a,
                b: None,
                k: 0.,
                cut: false,
            },
            Some(b) => Bracket {
                a,
                b: Some(a + 1),
                k: (t - self.samples[a].time) / (b.time - self.samples[a].time),
                cut: b.teleport,
            },
        })
    }

    /// frames.ts `sample`: interpolated, never extrapolated, never slid across a cut.
    fn sample(&self, br: Option<Bracket>, id: u32) -> Option<Vec2> {
        let br = br?;
        let find = |i: usize| {
            let rows = &self.samples[i].players;
            rows.binary_search_by_key(&id, |(k, _)| *k)
                .ok()
                .map(|j| rows[j].1)
        };
        let a = find(br.a);
        let b = br.b.and_then(find);
        match (a, b) {
            (Some(a), Some(b)) => Some(
                if br.cut || hypot(b.x - a.x, b.y - a.y) > TELEPORT_DISTANCE {
                    a
                } else {
                    Vec2::new(a.x + (b.x - a.x) * br.k, a.y + (b.y - a.y) * br.k)
                },
            ),
            _ => a.or(b),
        }
    }

    /// frames.ts:280-287 `velocity`: u/s from the sample VELOCITY_MS earlier, else 0.
    fn velocity(
        &self,
        prev: Option<Bracket>,
        prev_self: Option<Vec2>,
        id: u32,
        at: Vec2,
        cut: bool,
    ) -> Vec2 {
        let zero = Vec2::new(0., 0.);
        let Some(owner) = prev_self.filter(|_| !cut) else {
            return zero;
        };
        let Some(q) = self.sample(prev, id) else {
            return zero;
        };
        if !in_view(owner.x, owner.y, q.x, q.y, 0.)
            || hypot(at.x - q.x, at.y - q.y) > TELEPORT_DISTANCE
        {
            return zero;
        }
        Vec2::new(
            ((at.x - q.x) * 1000.) / VELOCITY_MS,
            ((at.y - q.y) * 1000.) / VELOCITY_MS,
        )
    }
}

#[derive(Clone, Copy)]
struct Bracket {
    a: usize,
    b: Option<usize>,
    k: f64,
    cut: bool,
}

/// What the tint reads of a drawn fighter or mob.
struct FighterRow {
    faction: Option<FactionId>,
    in_hand: Option<WeaponId>,
    alive: bool,
    dist: f64,
    los: bool,
}

/// The first id of the NPC namespace (`Frame14` refuses a player at or above it).
const NPC_BASE: u32 = 1 << 31;

/// The rendered key of a delivered actor id: players `p<id>`, sample-scoped NPC references `n<id>`.
pub(crate) fn key_of(id: u32) -> String {
    if id < NPC_BASE {
        player_key(PlayerId(id))
    } else {
        npc_key(PlayerId(id))
    }
}

fn actor_key(a: &WireActor) -> String {
    if a.kind == 0 {
        player_key(PlayerId(a.id))
    } else {
        npc_key(PlayerId(a.id))
    }
}

fn actor_at(a: &WireActor) -> Vec2 {
    Vec2::new(f64::from(a.x), f64::from(a.y))
}

fn mob_def(a: &WireActor) -> Option<&'static rh_sim::mob_catalog::MobTypeDef> {
    a.mob_type_code
        .checked_sub(1)
        .and_then(|n| MobTypeId::ALL.get(usize::from(n)))
        .and_then(|t| mob_type_by_id(t.as_str()))
}

fn faction_of(code: u8) -> Option<FactionId> {
    FactionId::ALL.get(usize::from(code)).copied()
}

/// Source `inHandOf`: the weapon in hand; an empty hand (drawn as fists) is `null`.
fn in_hand(code: u8) -> Option<WeaponId> {
    wire_weapon(code).filter(|w| *w != WeaponId::Fists)
}

fn weapon_name(code: u8) -> BVal {
    wire_weapon(code).map_or(BVal::Undefined, |w| BVal::text(w.as_str()))
}

fn opt_name(name: Option<&'static str>) -> BVal {
    name.map_or(BVal::Null, BVal::text)
}

fn name_or_code(table: &[&str], code: u8) -> String {
    table
        .get(usize::from(code))
        .map_or_else(|| code.to_string(), |s| (*s).to_owned())
}

fn status_name(s: Status) -> &'static str {
    match s {
        Status::Lobby => "lobby",
        Status::Alive => "alive",
        Status::Dead => "dead",
        Status::Mia => "mia",
    }
}

fn point(at: Vec2) -> BVal {
    BVal::obj([("x", BVal::num(at.x)), ("y", BVal::num(at.y))])
}

/// frames.ts:379-395: the nearest living foe in sight within the matchup range; a mob nearer than every player takes it.
fn nearest_foe(fighters: &[FighterRow], mobs: &[FighterRow]) -> Option<(usize, f64)> {
    let mut best = None;
    let mut best_dist = MATCHUP_RANGE;
    for (i, f) in fighters.iter().enumerate() {
        if !f.alive || f.faction.is_none() || f.dist >= best_dist || !f.los {
            continue;
        }
        best = Some(i);
        best_dist = f.dist;
    }
    for m in mobs {
        if !m.alive || m.faction.is_none() || m.dist >= best_dist || !m.los {
            continue;
        }
        best = None;
        best_dist = m.dist;
    }
    best.map(|i| (i, best_dist))
}

/// frames.ts `deliver`: one due world event in the window around the eye; attackers named only when drawn.
fn deliver(q: Queued, eye: Vec2, visible: &[String]) -> Option<BVal> {
    let Some(at) = q.at else {
        return Some(BVal::Obj(own(q.record)));
    };
    let on = in_view(eye.x, eye.y, at.x, at.y, 0.);
    let mut record = q.record;
    match q.lane {
        Lane::Masked | Lane::Plain | Lane::MobDeath if !on => return None,
        Lane::PlayerDeath if !on => {
            set(&mut record, "at", BVal::Null);
            set(&mut record, "by", BVal::Null);
        }
        Lane::EliteDeath if !on => set(&mut record, "at", BVal::Null),
        Lane::Masked | Lane::PlayerDeath | Lane::MobDeath => {
            // maskId: an attacker or killer is named only while it is drawn.
            let hidden = record.iter().any(|(k, v)| {
                *k == "by"
                    && v.as_str()
                        .is_some_and(|by| !visible.iter().any(|s| s == by))
            });
            if hidden {
                set(&mut record, "by", BVal::Null);
            }
        }
        Lane::EliteDeath | Lane::Plain => {}
    }
    Some(BVal::Obj(own(record)))
}

fn set(record: &mut [(&'static str, BVal)], key: &str, value: BVal) {
    if let Some(slot) = record.iter_mut().find(|(k, _)| *k == key) {
        slot.1 = value;
    }
}

fn own(record: Record) -> Vec<(String, BVal)> {
    record.into_iter().map(|(k, v)| (k.to_owned(), v)).collect()
}

/// perception.ts:702-708 `wishView`: the delivered Wish slot as the weapon bar shows it. The source `def` is shared
/// `ABILITIES[id]`; here it is built from the public catalog only (`bots::wish::WISHES` for what the cast policy reads,
/// `rh_sim::abilities::definition` for the cooldown and the order flag), in the source's own key order. Members no Brain
/// reader consumes (blurb, faction, telegraph, icon, colour, shape, cancelledBy, the non-policy effects and effect
/// durations) are left out. The rank is not on the wire: `undefined`. `None` only for an ability code outside the catalog.
fn wish_record(w: &rh_protocol::WireWishOwner, own_effects: u16) -> Option<BVal> {
    use crate::bots::wish::{AiIntent, BlockedBy, PolicyEffect, TargetRule};
    let id = *rh_sim::status_runtime::AbilityId::ALL.get(usize::from(w.ability))?;
    let row = crate::bots::wish::wish_by_id(id)?;
    let sim = rh_sim::abilities::definition(id);
    let ai = row.ai.iter().map(|a| {
        BVal::text(match a {
            AiIntent::Escape => "escape",
            AiIntent::Sustain => "sustain",
            AiIntent::Engage => "engage",
            AiIntent::Control => "control",
            AiIntent::Peel => "peel",
            AiIntent::Burst => "burst",
            AiIntent::Zone => "zone",
            AiIntent::Buff => "buff",
        })
    });
    let blocked = row.blocked_by.iter().map(|b| {
        BVal::text(match b {
            BlockedBy::Stun => "stun",
            BlockedBy::Silence => "silence",
            BlockedBy::Root => "root",
        })
    });
    let targeting = match row.rank.targeting {
        TargetRule::Self_ => BVal::obj([("kind", BVal::text("self"))]),
        TargetRule::Unit {
            range,
            los,
            snap_radius,
        } => BVal::obj([
            ("kind", BVal::text("unit")),
            ("range", BVal::num(range)),
            ("los", BVal::flag(los)),
            ("snapRadius", BVal::num(snap_radius)),
            ("who", BVal::text("enemy")),
        ]),
        TargetRule::Point { range, min_range } => BVal::obj([
            ("kind", BVal::text("point")),
            ("range", BVal::num(range)),
            ("minRange", BVal::num(min_range)),
        ]),
    };
    let effects = row.rank.effects.iter().map(|e| match *e {
        PolicyEffect::HidesCaster => BVal::obj([
            ("do", BVal::text("status")),
            ("to", BVal::text("self")),
            ("status", BVal::text("hidden")),
        ]),
        PolicyEffect::Blink { max_dist, min_dist } => BVal::obj([
            ("do", BVal::text("blink")),
            ("maxDist", BVal::num(max_dist)),
            ("minDist", BVal::num(min_dist)),
        ]),
    });
    let def = BVal::obj([
        ("id", BVal::text(id.as_str())),
        ("name", BVal::text(row.name)),
        ("ownOrder", BVal::flag(sim.own_order)),
        ("dropsLock", BVal::flag(row.drops_lock)),
        ("blockedBy", BVal::arr(blocked)),
        ("ai", BVal::arr(ai)),
        (
            "ranks",
            BVal::arr([BVal::obj([
                ("cooldownMs", BVal::num(sim.cooldown_ms)),
                ("castMs", BVal::num(row.rank.cast_ms)),
                ("targeting", targeting),
                ("effects", BVal::arr(effects)),
            ])]),
        ),
    ]);
    Some(BVal::obj([
        ("ability", BVal::text(id.as_str())),
        ("def", def),
        ("rank", BVal::Undefined),
        // perception.ts:706 `u32(me.wishReadyAt ?? 0)` (`>>> 0`).
        (
            "readyAt",
            BVal::num(f64::from(
                crate::bots::temporal_percept::modules::types::js_to_int32(w.ready_at),
            )),
        ),
        (
            "casting",
            BVal::flag(own_effects & crate::bots::wish::EFFECT_CASTING != 0),
        ),
    ]))
}

/// The owner's run result as delivered (shared messages.ts `RunResult`); the profile name and GV parts other than the
/// win bonus and the total are not on the wire and are left out.
fn result_record(r: &rh_protocol::WireResult) -> BVal {
    let outcome = match r.outcome {
        0 => "won",
        1 => "draw",
        2 => "died",
        _ => "mia",
    };
    BVal::obj([
        ("outcome", BVal::text(outcome)),
        ("durationSec", BVal::num(f64::from(r.duration_sec))),
        ("kills", BVal::num(f64::from(r.kills))),
        ("killedBy", BVal::opt_text(r.killed_by.as_deref())),
        ("place", BVal::num(f64::from(r.place))),
        ("players", BVal::num(f64::from(r.players))),
        (
            "gv",
            BVal::obj([
                ("win", BVal::num(f64::from(r.gv_win))),
                ("total", BVal::num(f64::from(r.gv_total))),
            ]),
        ),
        ("winBonusWithheld", BVal::flag(r.win_bonus_withheld)),
    ])
}

/// perception.ts:329-360 `selfView` from the owner row, the inventory, the owner-combat group and the build.
#[allow(clippy::too_many_arguments)]
fn self_record(
    me: &WireSelf,
    key: &str,
    name: Option<String>,
    weapons: &[Option<WeaponId>; 2],
    slot: usize,
    attack_target: BVal,
    mob_kills: f64,
    combat: &rh_protocol::WireOwnerCombat,
    build: &rh_protocol::WireBuild,
) -> BVal {
    let cards = rh_sim::cards::CardId::ALL.iter().zip(build.cards.iter());
    let power: f64 = cards
        .clone()
        .map(|(id, n)| f64::from(id.tier()) * f64::from(*n))
        .sum();
    let record: Vec<(String, BVal)> = cards
        .filter(|(_, n)| **n > 0)
        .map(|(id, n)| (id.as_str().to_owned(), BVal::num(f64::from(*n))))
        .collect();
    BVal::obj([
        ("id", BVal::text(key)),
        ("name", name.map_or(BVal::Undefined, BVal::text)),
        ("x", BVal::num(f64::from(me.x))),
        ("y", BVal::num(f64::from(me.y))),
        ("facing", BVal::num(f64::from(me.facing))),
        ("status", BVal::text(status_name(wire_status(me.status)))),
        ("hp", BVal::num(f64::from(me.hp))),
        ("maxHp", BVal::num(f64::from(me.max_hp))),
        ("barrier", BVal::num(f64::from(me.barrier))),
        (
            "faction",
            opt_name(faction_of(me.faction).map(FactionId::as_str)),
        ),
        (
            "weapons",
            BVal::arr(weapons.iter().map(|w| opt_name(w.map(WeaponId::as_str)))),
        ),
        ("slot", BVal::num(slot as f64)),
        ("attackTarget", attack_target),
        (
            "drawStartedAt",
            BVal::num(f64::from(combat.draw_started_at)),
        ),
        ("readyAt", BVal::num(f64::from(combat.ready_at))),
        ("immuneUntil", BVal::Undefined),
        ("sig", BVal::num(f64::from(me.sig))),
        ("brand", BVal::num(f64::from(me.brand))),
        ("power", BVal::num(power)),
        (
            "asMult",
            BVal::num(rh_sim::stat_fold::decode_mult(combat.as_milli)),
        ),
        (
            "windupMult",
            BVal::num(rh_sim::stat_fold::decode_mult(combat.windup_milli)),
        ),
        (
            "speedMult",
            BVal::num(rh_sim::stat_fold::decode_mult(combat.speed_milli)),
        ),
        ("kills", BVal::num(f64::from(me.kills))),
        ("mobKills", BVal::num(mob_kills)),
        ("gv", BVal::num(f64::from(me.gv))),
        ("bounty", BVal::num(f64::from(me.bounty))),
        ("moveSeq", BVal::num(f64::from(me.move_seq))),
        ("build", BVal::Obj(record)),
    ])
}

/// perception.ts:672-679: the private plan deal as the source's immediate `private` event (`type: "plan"`), from the
/// delivered plan group (shared messages.ts `PlanDeal` keys).
fn plan_event(plan: &WirePlan, now: f64) -> BVal {
    let opt = |v: Option<f64>| v.map_or(BVal::Null, BVal::num);
    let msg = BVal::obj([
        ("endsAt", BVal::num(plan.ends_at)),
        (
            "spawns",
            BVal::arr(plan.spawns.iter().map(|s| opt(s.map(f64::from)))),
        ),
        (
            "taken",
            BVal::arr(plan.taken.iter().map(|t| BVal::flag(*t))),
        ),
        ("pick", opt(plan.pick.map(f64::from))),
        (
            "boons",
            BVal::arr(plan.boons.iter().map(|b| BVal::text(b.clone()))),
        ),
        ("boon", opt(plan.boon.map(f64::from))),
    ]);
    BVal::obj([
        ("kind", BVal::text("private")),
        ("t", BVal::num(now)),
        ("at", BVal::Null),
        ("type", BVal::text("plan")),
        ("msg", msg),
    ])
}

// ---------------------------------------------------------------------------------------------------------------------
// The seat side: the accepted-history fence a `BrainBot` composes through.

/// One seat's composer behind the accepted-history fence (`FairPerceptRing14`: protocol, epoch, viewer, local session,
/// consecutive sample ids, clock, the player-memory prefix). The fence and the composer are checked together before
/// either changes, so a refused or stale frame leaves both untouched.
pub(crate) struct SeatComposer14 {
    me: PlayerId,
    tier: TierId,
    fence: Option<FairPerceptRing14>,
    composer: Composer14,
}

/// The fence's required owner groups (the planning screen carries the owner without its combat groups).
fn required(frame: &Frame14) -> &'static [Required14] {
    if frame.owner.is_some() && frame.phase != 3 {
        &[Required14::InventoryPresent, Required14::OwnerCombat]
    } else {
        &[]
    }
}

fn fence_refusal(error: FenceRefusal) -> InputRefusal {
    match error {
        FenceRefusal::Missing(Required14::InventoryPresent) => InputRefusal::InventoryUnavailable,
        FenceRefusal::Missing(Required14::OwnerCombat) => InputRefusal::OwnerCombatUnavailable,
        FenceRefusal::Viewer | FenceRefusal::Missing(Required14::OwnerPresent) => {
            InputRefusal::InvalidOwner
        }
        FenceRefusal::Memory(_) => InputRefusal::MemoryUnavailable,
        _ => InputRefusal::ClockResetRequired,
    }
}

fn composer_refusal(error: Refusal14) -> InputRefusal {
    match error {
        Refusal14::OwnerMissing => InputRefusal::InvalidOwner,
        Refusal14::InventoryMissing => InputRefusal::InventoryUnavailable,
        Refusal14::OwnerCombatMissing => InputRefusal::OwnerCombatUnavailable,
        Refusal14::BuildMissing => InputRefusal::MemoryUnavailable,
        // The source HUD (phase clocks, gates, coliseum) is the Arena group: a runtime without the source lifecycle cannot
        // host the Brain, so the seat's fallback plays instead of a Brain that sees no HUD.
        Refusal14::ArenaMissing => InputRefusal::ArenaUnavailable,
        Refusal14::Clock => InputRefusal::ClockResetRequired,
    }
}

impl SeatComposer14 {
    pub(crate) fn new(me: PlayerId, tier: TierId, setup: Setup14) -> Self {
        Self {
            me,
            tier,
            fence: None,
            composer: Composer14::new(setup),
        }
    }

    #[cfg(test)]
    pub(crate) fn setup(&self) -> &Setup14 {
        &self.composer.setup
    }

    fn fresh_fence(frame: &Frame14, tier: TierId) -> Result<FairPerceptRing14, InputRefusal> {
        let context = frame.context();
        FairPerceptRing14::new(context.epoch, context.viewer, tier, 2, MAX_RECORDS)
            .map_err(fence_refusal)
    }

    /// Immutable preflight (`Policy::check_input`): the viewer, the fence and the composer's refusals.
    pub(crate) fn check(&self, frame: &Frame14) -> Result<(), InputRefusal> {
        if frame.context().viewer.get() != self.me.0 {
            return Err(InputRefusal::InvalidOwner);
        }
        if let Some(owner) = frame.owner.as_ref() {
            if owner.id != self.me.0 {
                return Err(InputRefusal::InvalidOwner);
            }
            self.composer.check(frame).map_err(composer_refusal)?;
        }
        match &self.fence {
            Some(fence) => fence.check_preview(frame, required(frame)),
            None => Self::fresh_fence(frame, self.tier)?.check_preview(frame, required(frame)),
        }
        .map_err(fence_refusal)
    }

    /// Accept one frame into the fence and compose it. `Ok(None)`: an accepted sample without an owner row (nothing for
    /// the Brain to see), which advances the fence but asks no decision.
    pub(crate) fn compose(
        &mut self,
        accepted: &AcceptedFrame14,
    ) -> Result<Option<Composed14>, InputRefusal> {
        let frame = accepted.frame();
        self.check(frame)?;
        if self.fence.is_none() {
            self.fence = Some(Self::fresh_fence(frame, self.tier)?);
        }
        let fence = self.fence.as_mut().expect("created above");
        fence
            .accept(accepted, required(frame))
            .map_err(fence_refusal)?;
        // The fence keeps the newest sample only: the composer retains its own history.
        if fence.len() > 1 {
            let oldest = fence.retained()[0].context().sample;
            let _ = fence.release_through(oldest);
        }
        if frame.owner.is_none() {
            return Ok(None);
        }
        self.composer
            .compose(frame)
            .map(Some)
            .map_err(composer_refusal)
    }
}

/// The source feature verdicts a server configuration offers a seat: the client message set the Brain may send, and
/// which runtime parts exist (abilities, the planning phase, chests and camps with mobs, statuses, areas, floor hazards).
pub(crate) fn configured_features(sim: &rh_sim::SimConfig, map: &TileMap) -> Features {
    /// The client messages the Brain may send on this server (the source feature grammar's set).
    const FEATURE_MESSAGES: [&str; 11] = [
        "move",
        "stop",
        "target",
        "attack",
        "release",
        "swap",
        "pickup",
        "cast",
        "plan",
        "choose",
        "useConsumable",
    ];
    let abilities = sim.abilities != rh_sim::abilities::Mode::Off;
    let planning = matches!(sim.lifecycle, rh_sim::ArenaMode::Source(_));
    let camps = sim.mob_mode != rh_sim::mob_runtime::MobMode::Off;
    let hazards = sim.hazards != rh_sim::terrain::Mode::Off
        && map
            .layers()
            .is_some_and(|layers| layers.data().terrain.iter().any(|t| (4..=7).contains(t)));
    Features {
        message_types: FEATURE_MESSAGES.iter().map(|m| m.to_string()).collect(),
        wishes: abilities,
        status_effects: true,
        fields: abilities,
        planning,
        chests: true,
        skills: false,
        relics: true,
        camps,
        hazards,
    }
}

/// The Brain's map record and projections over the match's public static map (`Arena` layers; a hand-built map has
/// none, so its camps, coliseum and regions are empty). Called with the seat's public setup arena (no spawn points).
pub(crate) fn brain_map(arena: &Arena) -> super::config::BrainMap {
    use super::super::memory::{CampGeom, MemoryMap};
    use super::super::strategy::types::{CampDef, ColiseumDef, StrategyMap};
    use super::super::tactics::types::TacticsMap;
    let open = arena.map.clone();
    let locked = with_gates(&open);
    let data = open.layers().map(|layers| layers.data());
    let zone = |z: rh_sim::mapdata::Zone| FactionId::parse(z.as_str());
    let mut memory_camps = Vec::new();
    let mut strategy_camps = Vec::new();
    if let Some(data) = data {
        for camp in &data.camps {
            let Some(zone) = zone(camp.zone) else {
                continue;
            };
            let spots: Vec<Vec2> = camp.spots.iter().map(|s| Vec2::new(s.x, s.y)).collect();
            memory_camps.push(CampGeom {
                id: camp.id.clone(),
                zone,
                elite: camp.elite_spot >= 0,
                x: camp.x,
                y: camp.y,
                radius: if camp.radius > 0. {
                    camp.radius
                } else {
                    camp.r
                },
                spots: spots.clone(),
            });
            strategy_camps.push(CampDef {
                id: camp.id.clone(),
                zone,
                x: camp.x,
                y: camp.y,
                r: camp.r,
                spots,
                elite_spot: f64::from(camp.elite_spot),
                chest: Vec2::new(camp.chest.x, camp.chest.y),
                area: f64::from(camp.area),
                radius: camp.radius,
            });
        }
    }
    let centre = data.map_or(arena.centre(), |d| {
        Vec2::new(d.coliseum.centre.x, d.coliseum.centre.y)
    });
    let inner = data.map_or(Vec::new(), |d| {
        d.coliseum
            .inner_spawns
            .iter()
            .map(|s| Vec2::new(s.x, s.y))
            .collect()
    });
    let cells = (open.w * open.h) as usize;
    let region_grid = data.map_or(vec![0; cells], |d| d.region_grid.clone());
    let terrain = data.map_or(vec![0; cells], |d| d.terrain.clone());
    super::config::BrainMap {
        raw: BVal::obj([
            ("w", BVal::num(f64::from(open.w))),
            ("h", BVal::num(f64::from(open.h))),
        ]),
        strategy: StrategyMap {
            camps: strategy_camps,
            coliseum: ColiseumDef {
                centre,
                inner_spawns: inner,
            },
            width: f64::from(open.w),
            height: f64::from(open.h),
        },
        tactics: TacticsMap {
            tile_map: open.clone(),
            width: open.w,
            height: open.h,
            region_grid,
            coliseum_centre: centre,
            camps: memory_camps.clone(),
        },
        memory: MemoryMap {
            camps: memory_camps,
        },
        plan: crate::bots::planning::PlanMap::from_arena(arena),
        terrain,
        open,
        locked,
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    /// The admitted full gameplay map the source-arena profile runs on.
    pub(crate) fn seed1_arena() -> rh_sim::Arena {
        let file: rh_sim::mapdata::MapExport = serde_json::from_str(include_str!(
            "../../../../../rh-sim/src/mapdata/fixtures/seed1.map.json"
        ))
        .expect("seed1 map");
        file.validate()
            .expect("valid map")
            .into_arena()
            .expect("arena")
    }
}

/// The cloud session's composer oracles (P-BOT-BRAIN-LIVE-1, `compose14/tests.rs`): source grammar over whole Brain
/// matches, the hidden-state twin through `BrainBot`, and the seat profiling diagnostic.
#[cfg(test)]
mod tests;

/// P-BOT-BRAIN-RECONCILE-1: the seat fence and the derived `self.mobKills`.
#[cfg(test)]
mod reconcile_tests;

#[cfg(test)]
mod live2a_tests {
    //! P-BOT-BRAIN-LIVE-2a, beyond the oracle: a held lock with a redacted target reaches every component as held without a
    //! key, and an immediate event of a composition the ring does not cover yet is delivered by the first covered one.
    use super::super::adapters;
    use super::{Composer14, Setup14, BRAIN_WORLD_DELAY_MS};
    use crate::bots::view::Features;
    use crate::delivery::DeliverySession;
    use rh_sim::observe::SeenEvent;
    use rh_sim::{
        FactionId, ItemObserver, Observation, OwnerCombatView, OwnerLockView, Placement, PlayerId,
        Secrets, Sim, SimConfig, Vec2, WeaponId,
    };

    const OWNER: PlayerId = PlayerId(1);

    fn sim() -> Sim {
        let at = |profile: &str, faction, x: f64| Placement {
            profile: profile.into(),
            faction,
            bot: false,
            at: Vec2::new(x, 272.),
            hp: None,
            weapon0: Some(WeaponId::Wand),
            weapon1: None,
        };
        Sim::reset_active(
            SimConfig {
                consumables: false,
                ..Default::default()
            },
            rh_sim::arenas::practice_arena(),
            Secrets::from_seed(7),
            &[
                at("owner", FactionId::Fire, 300.),
                at("other", FactionId::Holy, 440.),
            ],
        )
    }

    fn scene(sim: &Sim, time: f64, tick: u32) -> Observation {
        let mut obs = Observation::default();
        ItemObserver::new(OWNER)
            .prepare_into(sim, &[], &mut obs, None)
            .expect("owner scene")
            .commit();
        obs.tick = tick;
        obs.server_time = time;
        obs.arena = Some(rh_sim::ArenaView {
            lobby_ends_at: 0.,
            plan_ends_at: 0.,
            raid_started_at: 500.,
            patience_ends_at: Some(60_000.),
            in_coliseum: false,
            gates_locked: false,
            sudden_death_at: 0.,
            started_with: 2,
        });
        obs
    }

    fn composer(sim: &Sim) -> Composer14 {
        Composer14::new(Setup14::public(
            sim.shared_arena(),
            Features {
                message_types: ["move", "stop", "target", "attack"]
                    .map(String::from)
                    .to_vec(),
                ..Features::default()
            },
            0.6,
        ))
    }

    #[test]
    fn a_redacted_held_lock_reaches_every_component_as_held_without_a_key() {
        let sim = sim();
        let mut obs = scene(&sim, 1000., 20);
        obs.owner_combat = Some(OwnerCombatView {
            lock: OwnerLockView::Held { target: None },
            draw_started_at: 0,
            ready_at: 0,
            as_milli: 1000.,
            windup_milli: 1000.,
            speed_milli: 1000.,
        });
        let mut session = DeliverySession::new(OWNER);
        let prepared = session.prepare(&obs, true, true, &[]).expect("scene");
        let frame = session.commit(prepared);
        let p = composer(&sim)
            .compose(frame.frame())
            .expect("composes")
            .percept;
        // `!== null` holds (memory.ts:776, strategy.ts:354, hazards.ts:123) and the target equals no key (fight.ts:176,
        // humanizer.ts:210): the one typed stand-in is `Some("")`.
        let held = Some(String::new());
        let memory = adapters::memory_percept(&p).expect("memory");
        assert_eq!(memory.self_.attack_target, held);
        let strategy = adapters::strategy_percept(&p).expect("strategy");
        assert_eq!(strategy.self_.attack_target, held);
        let tactic = adapters::tactic_percept(&p).expect("tactic");
        assert_eq!(tactic.self_.attack_target, held);
        let module = adapters::module_percept(&p).expect("module");
        assert_eq!(module.self_.attack_target, held);
        let hand = adapters::hand_percept(&p).expect("hand");
        assert_eq!(hand.self_view.attack_target, held);
        // The always-undefined numbers read as NaN (`+undefined`), never as a plausible 0. `self.mobKills` is derived
        // (P-BOT-BRAIN-RECONCILE-1, brief 6.4, DEV-026): no credited death seen yet is a count of 0.
        assert!(strategy.self_.mob_kills == 0. && tactic.self_.immune_until.is_nan());
        assert!(memory.minimap.t.is_nan() && tactic.hud.min_players.is_nan());
    }

    #[test]
    fn a_toast_before_the_ring_covers_the_view_time_is_delivered_once_covered() {
        let sim = sim();
        let mut composer = composer(&sim);
        let mut session = DeliverySession::new(OWNER);
        let mut seen = Vec::new();
        for (i, t) in [1000., 1050., 1100., 1150.].into_iter().enumerate() {
            let mut obs = scene(&sim, t, 20 + i as u32);
            if i == 0 {
                obs.events.push(SeenEvent::Toast {
                    text: "hello".into(),
                });
            }
            let prepared = session.prepare(&obs, true, true, &[]).expect("scene");
            let frame = session.commit(prepared);
            let c = composer.compose(frame.frame()).expect("composes");
            let toasts = c
                .percept
                .raw
                .get("events")
                .and_then(|e| e.as_arr())
                .map_or(0, |e| {
                    e.iter()
                        .filter(|e| e.get("kind").and_then(|k| k.as_str()) == Some("toast"))
                        .count()
                });
            seen.push((c.covered, toasts, c.percept.has_toast));
        }
        assert_eq!(BRAIN_WORLD_DELAY_MS, 100.);
        assert_eq!(
            seen,
            [
                (false, 0, false),
                (false, 0, false),
                (true, 1, true),
                (true, 0, false)
            ],
            "frames.ts:131 composes nothing before coverage; takeImmediate delivers the toast at the first percept"
        );
    }
}
