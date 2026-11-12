//! The production source `Percept` composer (P-BOT-BRAIN-LIVE-1): one seat's accepted [`Frame14`] history to the
//! complete declared Brain input record, under the owner-approved degraded fair profile.
//!
//! The composer reads only the accepted frame (owner, inventory, owner combat, actors, the state groups, the event and fx
//! batches) plus its own retained history and the match's public static map. It never sees `Sim`/`World`, a secret, a
//! hidden actor or a private identity: two worlds that differ only in what this viewer is not sent compose the same record
//! (the hidden-state twin test). Every key set is the source's (`brain/source_input.rs` `SELF_KEYS`, `HUD_KEYS`,
//! `FIGHTER_KEYS`, `MOB_KEYS`, `CONTAINER_KEYS`, `PROJECTILE_KEYS`, `MINIMAP_KEYS`, `FEATURE_KEYS`, `EXTRAS_KEYS`), in the
//! source's own-key order.
//!
//! **Degraded leaves.** A fact the accepted frame does not publish is an own `undefined` member, never a plausible
//! number and never read from hidden state (docs/DEVIATIONS.md DEV-025; the typed readers in `adapters.rs` give each one
//! the source's `undefined` behaviour):
//!
//! | Leaf | Why |
//! |---|---|
//! | `self.attackTarget` for `Held(None)` | the lock is held on a target this viewer may not see |
//! | `self.immuneUntil`, `self.name` (no roster row) | no owner deadline on the wire |
//! | `fighters[].drawStartedAt`, `mobs[].drawStartedAt` | no remote draw clock on the wire |
//! | `fighters[].name`/`bot` without a roster row | the roster is the only label source |
//! | `projectiles[].id`, `x0`, `y0`, `t0`, `range` | no projectile identity or launch course on the wire |
//! | `minimap.t` (rows empty) | no minimap snapshot on the wire |
//! | `hud.alive`, `hud.minPlayers` | no room-wide alive count or lobby minimum on the wire |
//! | `events[hit].weapon`, `extras.fields[].id` | the wire hit carries no weapon, a field no id |
//!
//! Derived, not unpublished: `self.mobKills` counts this seat's own accepted regional-mob death events credited to it
//! (the owner fact is not on the wire; `undefined` would make every farm score NaN); mob `vx/vy` are 0 because NPC
//! references are per sample (the source's own answer when the previous sample has no such id); `viewT` equals `now`
//! (the composer presents the newest accepted sample: the world delay is pinned to 0); remote `immune` is the delivered
//! teleport-immunity flag; a projectile's course is its delivered heading at its kind's public speed.

use std::sync::Arc;

use super::percept::Percept;
use super::trace::BVal;
use crate::bots::fair_percept14::{FairPerceptRing14, Refusal14, Required14};
use crate::bots::memory_prefix::MAX_RECORDS;
use crate::bots::types::{TierId, BOT_VIEW_HALF_H, BOT_VIEW_HALF_W};
use crate::bots::view::{in_view, Features};
use crate::bots::wish::{
    AiIntent, BlockedBy, PolicyEffect, TargetRule, EFFECT_CASTING, EFFECT_HIDDEN, WISHES,
};
use crate::delivery::frame::{status as decoded_status, weapon as decoded_weapon};
use crate::delivery::{AcceptedFrame14, Frame14};
use crate::InputRefusal;
use rh_protocol::{
    WireActor, WireEvent, WireFx, WireOwnerLock, WirePropKind, WireRewardId,
    ACTOR_FLAG_TELEPORT_IMMUNE,
};
use rh_sim::geometry::has_line_of_sight;
use rh_sim::map::MASK_SIGHT;
use rh_sim::mapgen::certify::source_hypot as hypot;
use rh_sim::{FactionId, PlayerId, Status, TileMap, Vec2, WeaponId};

/// The first actor id of the NPC reference namespace (`WireActor` ids at or above it are sample-scoped NPC references).
const NPC_BASE: u32 = 1 << 31;
/// `EFFECT_UNTARGETABLE` (the source's `targetable` test).
const EFFECT_UNTARGETABLE: u16 = 128;
/// Source frames.ts `TELEPORT_DISTANCE`: a step longer than this is a cut, not a walk (velocity 0).
const TELEPORT_DISTANCE: f64 = 200.;
/// Source matchup tint ranges (frames.ts `MATCHUP_RANGE`, `MATCHUP_FULL_RANGE`).
const MATCHUP_RANGE: f64 = 450.;
const MATCHUP_FULL_RANGE: f64 = 150.;
/// Source perception.ts `MIN_HEAL_SHOWN`: a heal under one point is not drawn.
const MIN_HEAL_SHOWN: f64 = 1.;
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
/// shared/chestBoosts.ts `CHEST_BOOST_STATS` (option ids `boost:<stat>`).
const CHEST_BOOST_STATS: [&str; 8] = [
    "ad",
    "ap",
    "armor",
    "shield",
    "maxHp",
    "attackSpeed",
    "moveSpeed",
    "lifesteal",
];
/// shared/killAugments.ts stat keys (option ids `kill:<key>:<gain>`), in the wire's `TrophyStatKey` order.
const TROPHY_KEYS: [&str; 9] = [
    "ad",
    "ap",
    "damage",
    "health",
    "attackSpeed",
    "armor",
    "mr",
    "speed",
    "leech",
];
const FIELD_KINDS: [&str; 3] = ["zone", "cloud", "trail"];
/// The signature kinds of `WireFx::SigHit` (`HIT_KIND_BURN`..`HIT_KIND_BLEED`).
const SIG_KINDS: [&str; 5] = ["burn", "disease", "backlash", "mark", "bleed"];

/// The public static setup one seat's composer binds once per match: never per-frame inference.
pub(crate) struct ComposeStatic {
    /// Milliseconds per simulation tick (`MatchStart::tick_ms`): an event's time is its batch tick's server time.
    pub(crate) tick_ms: f64,
    /// The tier's attention share (`TierParams.attention.central`).
    pub(crate) central: f64,
    /// The configured feature verdicts (bound from the server's `SimConfig`, never inferred from missing data).
    pub(crate) features: Features,
    /// The public collision map and its `withGates` view.
    pub(crate) open: TileMap,
    pub(crate) locked: TileMap,
    /// The public map's camp ids, in camp order (source `map.camps[i].id`, else `camp<i>`).
    pub(crate) camp_ids: Vec<String>,
}

/// The references one composed percept may name in a command: only what THIS accepted frame delivered.
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

/// One composed tick input: the Brain percept and the references its commands may resolve.
#[derive(Clone, Debug)]
pub(crate) struct Composed {
    pub(crate) percept: Percept,
    pub(crate) refs: Refs,
}

/// The rendered key of a delivered actor id: players `p<id>`, sample-scoped NPC references `n<id>`.
pub(crate) fn actor_key(id: u32) -> String {
    if id >= NPC_BASE {
        format!("n{id}")
    } else {
        format!("p{id}")
    }
}

fn status_text(code: u8) -> &'static str {
    match decoded_status(code) {
        Status::Lobby => "lobby",
        Status::Alive => "alive",
        Status::Dead => "dead",
        Status::Mia => "mia",
    }
}

fn weapon_val(code: Option<u8>) -> BVal {
    code.and_then(decoded_weapon)
        .map_or(BVal::Null, |w| BVal::text(w.as_str()))
}

fn faction_of(code: u8) -> Option<FactionId> {
    FactionId::ALL.get(code as usize).copied()
}

fn faction_val(code: u8) -> BVal {
    faction_of(code).map_or(BVal::Null, |f| BVal::text(f.as_str()))
}

fn phase_text(code: u8) -> &'static str {
    match code {
        0 => "lobby",
        1 => "active",
        2 => "ended",
        _ => "planning",
    }
}

fn milli(v: f64) -> f64 {
    v / 1000.
}

/// A composed fighter row with what the matchup tint reads: (row, distance, in sight and alive, faction, weapon in hand).
type FighterRow = (BVal, f64, bool, Option<FactionId>, Option<WeaponId>);

/// One seat's composer: the accepted-history fence (session, sample order, clock) plus what earlier accepted samples of
/// the same session showed (player positions for velocity, the delivered plan, the match winner, credited mob deaths).
pub(crate) struct Composer14 {
    me: PlayerId,
    tier: TierId,
    statics: Arc<ComposeStatic>,
    ring: Option<FairPerceptRing14>,
    /// The previous accepted sample's player positions (players only: NPC references never join across samples).
    prev: Vec<(u32, f64, f64)>,
    prev_time: Option<f64>,
    mob_kills: u32,
    winner: Option<String>,
    last_plan: Option<rh_protocol::WirePlan>,
}

fn ring_refusal(error: Refusal14) -> InputRefusal {
    match error {
        Refusal14::Missing(Required14::InventoryPresent) => InputRefusal::InventoryUnavailable,
        Refusal14::Missing(Required14::OwnerCombat) => InputRefusal::OwnerCombatUnavailable,
        Refusal14::Viewer | Refusal14::Missing(Required14::OwnerPresent) => {
            InputRefusal::InvalidOwner
        }
        Refusal14::Memory(_) => InputRefusal::MemoryUnavailable,
        _ => InputRefusal::ClockResetRequired,
    }
}

fn required(frame: &Frame14) -> &'static [Required14] {
    if frame.owner.is_some() && frame.phase != 3 {
        &[Required14::InventoryPresent, Required14::OwnerCombat]
    } else {
        &[]
    }
}

impl Composer14 {
    pub(crate) fn new(me: PlayerId, tier: TierId, statics: Arc<ComposeStatic>) -> Self {
        Self {
            me,
            tier,
            statics,
            ring: None,
            prev: Vec::new(),
            prev_time: None,
            mob_kills: 0,
            winner: None,
            last_plan: None,
        }
    }

    /// Immutable preflight (Policy::check_input): the viewer, the owner groups a decision needs and the history fence.
    pub(crate) fn check(&self, frame: &Frame14) -> Result<(), InputRefusal> {
        if frame.context().viewer.get() != self.me.0 {
            return Err(InputRefusal::InvalidOwner);
        }
        if let Some(owner) = frame.owner.as_ref() {
            if owner.id != self.me.0 {
                return Err(InputRefusal::InvalidOwner);
            }
            if frame.phase != 3 && frame.collections.build.is_none() {
                return Err(InputRefusal::MemoryUnavailable);
            }
            // The source HUD (phase clocks, gates, coliseum) is the Arena group: a runtime without the source lifecycle
            // cannot host this policy, so the seat's fallback plays instead of a Brain that sees no HUD.
            if frame.collections.arena.is_none() {
                return Err(InputRefusal::ArenaUnavailable);
            }
        }
        match &self.ring {
            Some(ring) => ring
                .check_preview(frame, required(frame))
                .map_err(ring_refusal),
            None => Self::fresh_ring(frame, self.tier)?
                .check_preview(frame, required(frame))
                .map_err(ring_refusal),
        }
    }

    fn fresh_ring(frame: &Frame14, tier: TierId) -> Result<FairPerceptRing14, InputRefusal> {
        let context = frame.context();
        FairPerceptRing14::new(context.epoch, context.viewer, tier, 2, MAX_RECORDS)
            .map_err(ring_refusal)
    }

    /// Accept one frame into the history and compose its percept. `Ok(None)`: an accepted sample with nothing for the
    /// Brain to see (no owner row yet), which advances the history but asks no decision.
    pub(crate) fn compose(
        &mut self,
        accepted: &AcceptedFrame14,
    ) -> Result<Option<Composed>, InputRefusal> {
        let frame = accepted.frame();
        self.check(frame)?;
        if self.ring.is_none() {
            self.ring = Some(Self::fresh_ring(frame, self.tier)?);
        }
        let ring = self.ring.as_mut().expect("created above");
        ring.accept(accepted, required(frame))
            .map_err(ring_refusal)?;
        // The ring keeps the newest sample only (velocity reads the composer's own previous positions).
        if ring.len() > 1 {
            let oldest = ring.retained()[0].context().sample;
            let _ = ring.release_through(oldest);
        }
        let composed = self.compose_frame(frame);
        self.prev = frame
            .actors
            .iter()
            .filter(|a| a.kind == 0)
            .map(|a| (a.id, f64::from(a.x), f64::from(a.y)))
            .collect();
        self.prev_time = Some(frame.source_time);
        Ok(composed)
    }

    fn roster_row(frame: &Frame14, id: u32) -> Option<&rh_protocol::WireRosterRow> {
        frame.collections.roster.iter().find(|row| row.id == id)
    }

    fn event_time(&self, frame: &Frame14, tick: u32) -> f64 {
        frame.source_time - f64::from(frame.tick.saturating_sub(tick)) * self.statics.tick_ms
    }

    fn compose_frame(&mut self, frame: &Frame14) -> Option<Composed> {
        let me = frame.owner.as_ref()?;
        let arena = frame.collections.arena.as_ref()?;
        let statics = Arc::clone(&self.statics);
        let now = frame.source_time;
        let eye = Vec2::new(f64::from(me.x), f64::from(me.y));
        let self_key = actor_key(me.id);
        let sight = if arena.gates_locked {
            &statics.locked
        } else {
            &statics.open
        };
        let mut refs = Refs::default();
        let central = |at: Vec2| {
            (at.x - eye.x).abs() <= statics.central * BOT_VIEW_HALF_W
                && (at.y - eye.y).abs() <= statics.central * BOT_VIEW_HALF_H
        };
        let dt = self.prev_time.map(|t| now - t).filter(|dt| *dt > 0.);

        // Every delivered actor stays addressable for a command this tick, drawn or not (the seat resolves it).
        for a in &frame.actors {
            refs.actors.push((actor_key(a.id), PlayerId(a.id)));
        }
        let shown = |a: &WireActor| {
            a.effects & EFFECT_HIDDEN == 0
                && in_view(eye.x, eye.y, f64::from(a.x), f64::from(a.y), 0.)
        };

        // Fighters: delivered player rows in the camera box, alive or in the lobby (source frames.ts).
        let mut fighters: Vec<FighterRow> = Vec::new();
        let mut shown_at: Vec<(String, Vec2)> = vec![(self_key.clone(), eye)];
        for a in frame.actors.iter().filter(|a| a.kind == 0 && shown(a)) {
            let status = status_text(a.status);
            if status != "alive" && status != "lobby" {
                continue;
            }
            let at = Vec2::new(f64::from(a.x), f64::from(a.y));
            let (vx, vy) = match (dt, self.prev.iter().find(|(id, _, _)| *id == a.id)) {
                (Some(dt), Some((_, px, py)))
                    if hypot(at.x - px, at.y - py) <= TELEPORT_DISTANCE =>
                {
                    (((at.x - px) * 1000.) / dt, ((at.y - py) * 1000.) / dt)
                }
                _ => (0., 0.),
            };
            let dist = hypot(at.x - eye.x, at.y - eye.y);
            let los = has_line_of_sight(sight, eye, at, MASK_SIGHT);
            let roster = Self::roster_row(frame, a.id);
            let key = actor_key(a.id);
            shown_at.push((key.clone(), at));
            let row = BVal::Obj(vec![
                ("id".into(), BVal::text(key)),
                (
                    "name".into(),
                    roster.map_or(BVal::Undefined, |r| BVal::text(r.name.clone())),
                ),
                (
                    "bot".into(),
                    roster.map_or(BVal::Undefined, |r| BVal::flag(r.bot)),
                ),
                ("x".into(), BVal::num(at.x)),
                ("y".into(), BVal::num(at.y)),
                ("facing".into(), BVal::num(f64::from(a.facing))),
                ("status".into(), BVal::text(status)),
                ("hpFrac".into(), BVal::num(f64::from(a.hp_pct) / 100.)),
                (
                    "barrierFrac".into(),
                    BVal::num(f64::from(a.barrier_pct) / 100.),
                ),
                ("faction".into(), faction_val(a.faction)),
                ("inHand".into(), weapon_val(Some(a.weapon))),
                ("drawStartedAt".into(), BVal::Undefined),
                ("bounty".into(), BVal::num(f64::from(a.bounty))),
                (
                    "immune".into(),
                    BVal::flag(a.flags & ACTOR_FLAG_TELEPORT_IMMUNE != 0),
                ),
                ("sig".into(), BVal::num(f64::from(a.sig))),
                ("brand".into(), BVal::num(f64::from(a.brand))),
                (
                    "targetable".into(),
                    BVal::flag(a.effects & EFFECT_UNTARGETABLE == 0),
                ),
                ("vx".into(), BVal::num(vx)),
                ("vy".into(), BVal::num(vy)),
                ("dist".into(), BVal::num(dist)),
                ("los".into(), BVal::flag(los)),
                ("tint".into(), BVal::num(0.)),
                ("central".into(), BVal::flag(central(at))),
            ]);
            fighters.push((
                row,
                dist,
                los && status == "alive",
                faction_of(a.faction),
                decoded_weapon(a.weapon),
            ));
        }

        // Mobs: delivered NPC rows in the box (regional mobs, the dummies, companions and quest givers).
        let mut mobs: Vec<(BVal, f64, bool)> = Vec::new();
        for a in frame.actors.iter().filter(|a| a.kind != 0 && shown(a)) {
            let at = Vec2::new(f64::from(a.x), f64::from(a.y));
            let mob_type = a
                .mob_type_code
                .checked_sub(1)
                .and_then(|n| rh_sim::mob_catalog::MobTypeId::ALL.get(n as usize))
                .and_then(|t| rh_sim::mob_catalog::mob_type_by_id(t.as_str()));
            let kind = match a.kind {
                1 => mob_type.map_or("mob", |t| if t.elite { "elite" } else { "mob" }),
                3 => "dummy",
                _ => "npc",
            };
            let status = status_text(a.status);
            let dist = hypot(at.x - eye.x, at.y - eye.y);
            let los = has_line_of_sight(sight, eye, at, MASK_SIGHT);
            let key = actor_key(a.id);
            shown_at.push((key.clone(), at));
            let row = BVal::Obj(vec![
                ("id".into(), BVal::text(key)),
                ("kind".into(), BVal::text(kind)),
                ("name".into(), BVal::text(mob_type.map_or("", |t| t.name))),
                (
                    "type".into(),
                    mob_type.map_or(BVal::Undefined, |t| BVal::text(t.id.as_str())),
                ),
                ("faction".into(), faction_val(a.faction)),
                ("x".into(), BVal::num(at.x)),
                ("y".into(), BVal::num(at.y)),
                ("facing".into(), BVal::num(f64::from(a.facing))),
                ("status".into(), BVal::text(status)),
                ("hpFrac".into(), BVal::num(f64::from(a.hp_pct) / 100.)),
                ("inHand".into(), weapon_val(Some(a.weapon))),
                ("drawStartedAt".into(), BVal::Undefined),
                ("sig".into(), BVal::num(f64::from(a.sig))),
                ("brand".into(), BVal::num(f64::from(a.brand))),
                ("vx".into(), BVal::num(0.)),
                ("vy".into(), BVal::num(0.)),
                ("dist".into(), BVal::num(dist)),
                ("los".into(), BVal::flag(los)),
                ("central".into(), BVal::flag(central(at))),
            ]);
            mobs.push((
                row,
                dist,
                los && status == "alive" && faction_of(a.faction).is_some(),
            ));
        }

        // Source tintNearestFoe: one hue on the nearest foe in sight within MATCHUP_RANGE, if that foe is a player.
        let my_slot = frame.collections.inventory.map_or(0, |i| i.active_slot) as usize;
        let my_weapon = frame
            .collections
            .inventory
            .and_then(|i| i.slots.get(my_slot).copied().flatten())
            .and_then(decoded_weapon);
        if phase_text(frame.phase) == "active"
            && status_text(me.status) == "alive"
            && faction_of(me.faction).is_some()
        {
            let mut best: Option<usize> = None;
            let mut best_distance = MATCHUP_RANGE;
            for (index, (_, dist, ok, faction, _)) in fighters.iter().enumerate() {
                if *ok && faction.is_some() && *dist < best_distance {
                    best = Some(index);
                    best_distance = *dist;
                }
            }
            for (_, dist, ok) in &mobs {
                if *ok && *dist < best_distance {
                    best = None;
                    best_distance = *dist;
                }
            }
            if let Some(index) = best {
                let score = my_weapon
                    .zip(fighters[index].4)
                    .map_or(0., |(mine, theirs)| {
                        f64::from(crate::bots::mob_hunt::weapon_edge(mine, theirs))
                    });
                let value = if best_distance >= MATCHUP_RANGE || score == 0. {
                    0.
                } else {
                    let fade = if best_distance <= MATCHUP_FULL_RANGE {
                        1.
                    } else {
                        (MATCHUP_RANGE - best_distance) / (MATCHUP_RANGE - MATCHUP_FULL_RANGE)
                    };
                    (score.clamp(-2., 2.) / 2.) * fade
                };
                if let BVal::Obj(fields) = &mut fighters[index].0 {
                    if let Some(slot) = fields.iter_mut().find(|(k, _)| k == "tint") {
                        slot.1 = BVal::num(value);
                    }
                }
            }
        }
        let seen = |id: u32| -> Option<Vec2> {
            let key = actor_key(id);
            shown_at.iter().find(|(k, _)| *k == key).map(|(_, at)| *at)
        };
        let visible_id = |id: Option<u32>| -> BVal {
            id.filter(|id| seen(*id).is_some())
                .map_or(BVal::Null, |id| BVal::text(actor_key(id)))
        };

        // Containers: the delivered props in the box (quest items are not containers), with the focus as the target.
        let focus = frame.collections.props.focus;
        let mut containers = Vec::new();
        for prop in &frame.collections.props.rows {
            let kind = match &prop.kind {
                WirePropKind::Ground(_) => "ground",
                WirePropKind::Chest { .. } => "chest",
                WirePropKind::Body { .. } => "body",
                WirePropKind::Corpse { .. } => "corpse",
                WirePropKind::Cannon { .. } => "cannon",
                WirePropKind::WindEmblem => "consumable",
                WirePropKind::QuestItem { .. } => continue,
            };
            let at = Vec2::new(
                f64::from(rh_protocol::quant::dequantize_pos(prop.x)),
                f64::from(rh_protocol::quant::dequantize_pos(prop.y)),
            );
            if !in_view(eye.x, eye.y, at.x, at.y, 0.) {
                continue;
            }
            let is_target = focus.is_some_and(|f| f.handle == prop.handle);
            let (closed, weapon) = match &prop.kind {
                WirePropKind::Ground(code) => {
                    let w = weapon_val(Some(*code));
                    (!matches!(w, BVal::Null), w)
                }
                WirePropKind::Body { .. } | WirePropKind::Corpse { .. } if is_target => (
                    true,
                    focus
                        .and_then(|f| f.body_hint)
                        .map_or(BVal::Undefined, |code| weapon_val(Some(code))),
                ),
                WirePropKind::Body { .. } | WirePropKind::Corpse { .. } => (true, BVal::Undefined),
                WirePropKind::Chest { open } => {
                    (!open, if *open { BVal::Null } else { BVal::Undefined })
                }
                _ => (false, BVal::Null),
            };
            let label = match &prop.kind {
                WirePropKind::Body { label } | WirePropKind::Corpse { label } => label.clone(),
                _ => String::new(),
            };
            let key = format!("c{}", prop.handle.get());
            refs.pickups.push((key.clone(), prop.handle.get()));
            containers.push(BVal::Obj(vec![
                ("id".into(), BVal::text(key)),
                ("kind".into(), BVal::text(kind)),
                ("x".into(), BVal::num(at.x)),
                ("y".into(), BVal::num(at.y)),
                ("label".into(), BVal::text(label)),
                ("closed".into(), BVal::flag(closed)),
                ("weapon".into(), weapon),
                ("interactable".into(), BVal::flag(is_target)),
                ("dist".into(), BVal::num(hypot(at.x - eye.x, at.y - eye.y))),
            ]));
        }

        // Projectiles: the visible current flights; their course is the delivered heading at the kind's public speed.
        let mut projectiles = Vec::new();
        for p in &frame.collections.projectiles {
            let (kind, weapon) = match p.kind {
                0 => ("arrow", WeaponId::Bow),
                _ => ("ball", WeaponId::Wand),
            };
            let speed = match rh_sim::content::weapon(weapon).shape {
                rh_sim::content::Shape::Projectile { speed, .. } => speed,
                rh_sim::content::Shape::Arc { .. } => 0.,
            };
            let a = f64::from(rh_protocol::quant::dequantize_facing(p.facing));
            let from = match p.owner {
                Some(owner) if owner == me.id => BVal::text(self_key.clone()),
                other => visible_id(other),
            };
            projectiles.push(BVal::Obj(vec![
                ("id".into(), BVal::Undefined),
                ("kind".into(), BVal::text(kind)),
                (
                    "x".into(),
                    BVal::num(f64::from(rh_protocol::quant::dequantize_pos(p.x))),
                ),
                (
                    "y".into(),
                    BVal::num(f64::from(rh_protocol::quant::dequantize_pos(p.y))),
                ),
                ("vx".into(), BVal::num(rh_sim::math::cos(a) * speed)),
                ("vy".into(), BVal::num(rh_sim::math::sin(a) * speed)),
                ("x0".into(), BVal::Undefined),
                ("y0".into(), BVal::Undefined),
                ("t0".into(), BVal::Undefined),
                ("range".into(), BVal::Undefined),
                ("from".into(), from),
            ]));
        }

        // Events: the accepted fx and event batches, world lane in tick order (fx before events of a tick), then the
        // immediate lane (toasts, the owner's result, the private plan deal).
        let mut world: Vec<(u32, BVal)> = Vec::new();
        let mut immediate: Vec<BVal> = Vec::new();
        let point = |at: Option<Vec2>| {
            at.map_or(BVal::Null, |p| {
                BVal::Obj(vec![
                    ("x".into(), BVal::num(p.x)),
                    ("y".into(), BVal::num(p.y)),
                ])
            })
        };
        for batch in &frame.fx {
            let t = self.event_time(frame, batch.tick);
            for fx in &batch.fx {
                let ev = |kind: &str, at: Option<Vec2>, rest: Vec<(&str, BVal)>| {
                    let mut fields = vec![
                        ("kind".to_string(), BVal::text(kind)),
                        ("t".to_string(), BVal::num(t)),
                        ("at".to_string(), point(at)),
                    ];
                    fields.extend(rest.into_iter().map(|(k, v)| (k.to_string(), v)));
                    BVal::Obj(fields)
                };
                let row = match *fx {
                    WireFx::Windup { by, weapon, a, ms } => seen(by).map(|at| {
                        ev(
                            "windup",
                            Some(at),
                            vec![
                                ("by", BVal::text(actor_key(by))),
                                ("weapon", weapon_val(Some(weapon))),
                                ("a", BVal::num(f64::from(a))),
                                ("ms", BVal::num(f64::from(ms))),
                            ],
                        )
                    }),
                    WireFx::Swing { by, weapon, a, .. } => seen(by).map(|at| {
                        ev(
                            "swing",
                            Some(at),
                            vec![
                                ("by", BVal::text(actor_key(by))),
                                ("weapon", weapon_val(Some(weapon))),
                                ("a", BVal::num(f64::from(a))),
                            ],
                        )
                    }),
                    WireFx::Hit {
                        victim, by, amount, ..
                    } => seen(victim).map(|at| {
                        // Source: the number drawn, whole points (a blow is at least 1).
                        let amount = f64::from(amount);
                        let shown = if amount > 0. {
                            rh_sim::math::js_round(amount).max(1.)
                        } else {
                            rh_sim::math::js_round(amount)
                        };
                        ev(
                            "hit",
                            Some(at),
                            vec![
                                ("id", BVal::text(actor_key(victim))),
                                ("by", visible_id((by != u32::MAX).then_some(by))),
                                ("amount", BVal::num(shown)),
                                ("weapon", BVal::Undefined),
                                ("sig", BVal::Null),
                            ],
                        )
                    }),
                    WireFx::SigHit {
                        victim,
                        by,
                        kind,
                        amount,
                    } => seen(victim).map(|at| {
                        let sig = (kind as usize)
                            .checked_sub(1)
                            .and_then(|i| SIG_KINDS.get(i))
                            .map_or(BVal::Null, |s| BVal::text(*s));
                        ev(
                            "hit",
                            Some(at),
                            vec![
                                ("id", BVal::text(actor_key(victim))),
                                ("by", visible_id((by != u32::MAX).then_some(by))),
                                (
                                    "amount",
                                    BVal::num(rh_sim::math::js_round(f64::from(amount))),
                                ),
                                ("weapon", BVal::Undefined),
                                ("sig", sig),
                            ],
                        )
                    }),
                    WireFx::Block { id, by, weapon } => seen(id).map(|at| {
                        ev(
                            "block",
                            Some(at),
                            vec![
                                ("id", BVal::text(actor_key(id))),
                                ("by", visible_id(Some(by))),
                                ("weapon", weapon_val(Some(weapon))),
                            ],
                        )
                    }),
                    WireFx::Stagger { id } => seen(id)
                        .map(|at| ev("stagger", Some(at), vec![("id", BVal::text(actor_key(id)))])),
                    WireFx::Cancel { id } => seen(id)
                        .map(|at| ev("cancel", Some(at), vec![("id", BVal::text(actor_key(id)))])),
                    WireFx::Heal { id, amount } => seen(id)
                        .filter(|_| f64::from(amount) >= MIN_HEAL_SHOWN)
                        .map(|at| {
                            ev(
                                "heal",
                                Some(at),
                                vec![
                                    ("id", BVal::text(actor_key(id))),
                                    (
                                        "amount",
                                        BVal::num(rh_sim::math::js_round(f64::from(amount))),
                                    ),
                                ],
                            )
                        }),
                    WireFx::Teleport => Some(ev("teleport", None, Vec::new())),
                    // No current Brain consumer reads the Wish cast cues as events (DEV-025).
                    WireFx::WishStarted { .. }
                    | WireFx::WishLanded { .. }
                    | WireFx::WishEnded { .. } => None,
                };
                if let Some(row) = row {
                    world.push((batch.tick, row));
                }
            }
        }
        let name_of = |id: u32| -> String {
            if id >= NPC_BASE {
                frame
                    .actors
                    .iter()
                    .find(|a| a.id == id)
                    .and_then(|a| a.mob_type_code.checked_sub(1))
                    .and_then(|n| rh_sim::mob_catalog::MobTypeId::ALL.get(n as usize))
                    .and_then(|t| rh_sim::mob_catalog::mob_type_by_id(t.as_str()))
                    .map_or(String::new(), |t| t.name.to_string())
            } else {
                Self::roster_row(frame, id).map_or(String::new(), |r| r.name.clone())
            }
        };
        let mut event_rows: Vec<(u32, BVal)> = Vec::new();
        for batch in &frame.events {
            let t = self.event_time(frame, batch.tick);
            for event in &batch.events {
                let base = |kind: &str, at: Option<Vec2>| {
                    vec![
                        ("kind".to_string(), BVal::text(kind)),
                        ("t".to_string(), BVal::num(t)),
                        ("at".to_string(), point(at)),
                    ]
                };
                match event {
                    WireEvent::Death { id, by } => {
                        let mob = *id >= NPC_BASE;
                        // The owner's own credited regional-mob kills, as this seat saw them (DEV-025).
                        if mob
                            && *by == Some(me.id)
                            && frame.actors.iter().any(|a| a.id == *id && a.kind == 1)
                        {
                            self.mob_kills += 1;
                        }
                        let at = seen(*id);
                        let mut fields = base("death", at);
                        fields.push(("id".into(), BVal::text(actor_key(*id))));
                        fields.push(("name".into(), BVal::text(name_of(*id))));
                        fields.push((
                            "by".into(),
                            if at.is_some() {
                                visible_id(*by)
                            } else {
                                BVal::Null
                            },
                        ));
                        fields.push(("mob".into(), BVal::flag(mob)));
                        event_rows.push((batch.tick, BVal::Obj(fields)));
                    }
                    WireEvent::Bounty { id, bounty } => {
                        let mut fields = base("bounty", None);
                        fields.push(("id".into(), BVal::text(actor_key(*id))));
                        fields.push(("name".into(), BVal::text(name_of(*id))));
                        fields.push(("bounty".into(), BVal::num(f64::from(*bounty))));
                        event_rows.push((batch.tick, BVal::Obj(fields)));
                    }
                    WireEvent::MatchEnded { winner, draw } => {
                        let name = winner.map(&name_of);
                        self.winner = name.clone();
                        let mut fields = base("victory", None);
                        fields.push((
                            "id".into(),
                            winner.map_or(BVal::Null, |id| BVal::text(actor_key(id))),
                        ));
                        fields.push(("name".into(), BVal::opt_text(name.as_deref())));
                        fields.push(("draw".into(), BVal::flag(*draw)));
                        event_rows.push((batch.tick, BVal::Obj(fields)));
                    }
                    WireEvent::Toast { text } => {
                        let mut fields = base("toast", None);
                        fields.push(("text".into(), BVal::text(text.clone())));
                        immediate.push(BVal::Obj(fields));
                    }
                    // The owner's run result is an opaque record the Brain only notices; the remaining notices are
                    // fixed client strings the wire carries as codes (never decoded into invented text).
                    WireEvent::Result(_) => {
                        let mut fields = base("result", None);
                        fields.push(("result".into(), BVal::Obj(Vec::new())));
                        immediate.push(BVal::Obj(fields));
                    }
                    _ => {}
                }
            }
        }
        world.extend(event_rows);
        world.sort_by_key(|(tick, _)| *tick);
        // Source sends the private deal when it changes: the delivered plan group, once per change.
        if frame.collections.plan != self.last_plan {
            if let Some(plan) = frame.collections.plan.as_ref() {
                let opt = |v: Option<f64>| v.map_or(BVal::Null, BVal::num);
                let msg = BVal::Obj(vec![
                    ("endsAt".into(), BVal::num(plan.ends_at)),
                    (
                        "spawns".into(),
                        BVal::Arr(plan.spawns.iter().map(|s| opt(s.map(f64::from))).collect()),
                    ),
                    (
                        "taken".into(),
                        BVal::Arr(plan.taken.iter().map(|t| BVal::flag(*t)).collect()),
                    ),
                    ("pick".into(), opt(plan.pick.map(f64::from))),
                    (
                        "boons".into(),
                        BVal::Arr(plan.boons.iter().map(|b| BVal::text(b.clone())).collect()),
                    ),
                    ("boon".into(), opt(plan.boon.map(f64::from))),
                ]);
                immediate.push(BVal::Obj(vec![
                    ("kind".into(), BVal::text("private")),
                    ("t".into(), BVal::num(now)),
                    ("at".into(), BVal::Null),
                    ("type".into(), BVal::text("plan")),
                    ("msg".into(), msg),
                ]));
            }
            self.last_plan = frame.collections.plan.clone();
        }
        let has_toast = immediate
            .iter()
            .any(|e| e.get("kind").and_then(BVal::as_str) == Some("toast"));
        let mut events: Vec<BVal> = world.into_iter().map(|(_, e)| e).collect();
        events.extend(immediate);

        // The owner record (source selfView order).
        let inventory = frame.collections.inventory;
        let combat = frame.owner_combat;
        let build = frame.collections.build;
        let (attack_target, me_attack_target) = match combat.map(|c| c.lock) {
            Some(WireOwnerLock::Held { target: Some(id) }) => {
                (BVal::text(actor_key(id)), Some(actor_key(id)))
            }
            Some(WireOwnerLock::Held { target: None }) => (
                BVal::Undefined,
                Some(super::adapters::UNDEFINED_LOCK_ID.to_string()),
            ),
            _ => (BVal::Null, None),
        };
        let weapons = inventory.map_or([None, None], |i| i.slots);
        let power = build.map_or(0., |b| {
            rh_sim::cards::CardId::ALL
                .iter()
                .map(|id| f64::from(id.tier()) * f64::from(b.cards[id.index()]))
                .sum()
        });
        let build_record = build.map_or(BVal::Null, |b| {
            BVal::Obj(
                rh_sim::cards::CardId::ALL
                    .iter()
                    .filter(|id| b.cards[id.index()] > 0)
                    .map(|id| {
                        (
                            id.as_str().to_string(),
                            BVal::num(f64::from(b.cards[id.index()])),
                        )
                    })
                    .collect(),
            )
        });
        let draw_started_at = combat.map_or(0., |c| f64::from(c.draw_started_at));
        let self_status = status_text(me.status);
        let self_record = BVal::Obj(vec![
            ("id".into(), BVal::text(self_key.clone())),
            (
                "name".into(),
                Self::roster_row(frame, me.id)
                    .map_or(BVal::Undefined, |r| BVal::text(r.name.clone())),
            ),
            ("x".into(), BVal::num(eye.x)),
            ("y".into(), BVal::num(eye.y)),
            ("facing".into(), BVal::num(f64::from(me.facing))),
            ("status".into(), BVal::text(self_status)),
            ("hp".into(), BVal::num(f64::from(me.hp))),
            ("maxHp".into(), BVal::num(f64::from(me.max_hp))),
            ("barrier".into(), BVal::num(f64::from(me.barrier))),
            ("faction".into(), faction_val(me.faction)),
            (
                "weapons".into(),
                BVal::Arr(weapons.iter().map(|w| weapon_val(*w)).collect()),
            ),
            (
                "slot".into(),
                BVal::num(f64::from(inventory.map_or(0, |i| i.active_slot.min(1)))),
            ),
            ("attackTarget".into(), attack_target),
            ("drawStartedAt".into(), BVal::num(draw_started_at)),
            (
                "readyAt".into(),
                BVal::num(combat.map_or(0., |c| f64::from(c.ready_at))),
            ),
            ("immuneUntil".into(), BVal::Undefined),
            ("sig".into(), BVal::num(f64::from(me.sig))),
            ("brand".into(), BVal::num(f64::from(me.brand))),
            ("power".into(), BVal::num(power)),
            ("build".into(), build_record),
            (
                "asMult".into(),
                BVal::num(combat.map_or(1., |c| milli(c.as_milli))),
            ),
            (
                "windupMult".into(),
                BVal::num(combat.map_or(1., |c| milli(c.windup_milli))),
            ),
            (
                "speedMult".into(),
                BVal::num(combat.map_or(1., |c| milli(c.speed_milli))),
            ),
            ("kills".into(), BVal::num(f64::from(me.kills))),
            ("mobKills".into(), BVal::num(f64::from(self.mob_kills))),
            ("gv".into(), BVal::num(f64::from(me.gv))),
            ("bounty".into(), BVal::num(f64::from(me.bounty))),
            ("moveSeq".into(), BVal::num(f64::from(me.move_seq))),
        ]);

        let phase = phase_text(frame.phase);
        let hud = BVal::Obj(vec![
            ("phase".into(), BVal::text(phase)),
            ("training".into(), BVal::flag(frame.training)),
            ("lobbyEndsAt".into(), BVal::num(arena.lobby_ends_at)),
            ("raidStartedAt".into(), BVal::num(arena.raid_started_at)),
            // Source schema: `patienceEndsAt` is 0 while no timer runs (the wire's typed `None`).
            (
                "patienceEndsAt".into(),
                BVal::num(arena.patience_ends_at.unwrap_or(0.)),
            ),
            ("suddenDeathAt".into(), BVal::num(arena.sudden_death_at)),
            ("inColiseum".into(), BVal::flag(arena.in_coliseum)),
            ("gatesLocked".into(), BVal::flag(arena.gates_locked)),
            (
                "startedWith".into(),
                BVal::num(f64::from(arena.started_with)),
            ),
            ("alive".into(), BVal::Undefined),
            (
                "playerCount".into(),
                BVal::num(frame.collections.roster.len() as f64),
            ),
            ("minPlayers".into(), BVal::Undefined),
            (
                "winner".into(),
                BVal::text(self.winner.clone().unwrap_or_default()),
            ),
        ]);
        let minimap = BVal::Obj(vec![
            ("t".into(), BVal::Undefined),
            ("mobs".into(), BVal::Arr(Vec::new())),
            ("gatesLocked".into(), BVal::flag(arena.gates_locked)),
        ]);

        // Extras, each behind its feature gate (source perception.ts `extras`).
        let features = &statics.features;
        let mut extras = Vec::new();
        if features.wishes {
            let wish = me.wish.as_ref().and_then(|w| {
                let ability = rh_sim::status_runtime::AbilityId::ALL.get(w.ability as usize)?;
                Some(BVal::Obj(vec![
                    ("ability".into(), BVal::text(ability.as_str())),
                    ("def".into(), wish_def(*ability)),
                    ("rank".into(), BVal::num(1.)),
                    ("readyAt".into(), BVal::num(w.ready_at)),
                    (
                        "casting".into(),
                        BVal::flag(me.effects & EFFECT_CASTING != 0 || w.cast.is_some()),
                    ),
                ]))
            });
            if let Some(wish) = wish {
                extras.push(("wish".to_string(), wish));
            }
        }
        if features.chests {
            let mut rows = Vec::new();
            for chest in &frame.collections.reward_chests {
                let key = format!("r{}", chest.handle.get());
                refs.chests.push((key.clone(), chest.handle.get()));
                let options = chest.can_choose.then(|| {
                    chest
                        .options
                        .iter()
                        .map(|o| match o.id {
                            WireRewardId::Card(i) => rh_sim::cards::CardId::ALL
                                .get(i as usize)
                                .map_or(String::new(), |c| c.as_str().to_string()),
                            WireRewardId::Boost(i) => {
                                format!("boost:{}", CHEST_BOOST_STATS[(i as usize).min(7)])
                            }
                            WireRewardId::Kill { key, gain } => {
                                format!("kill:{}:{gain}", TROPHY_KEYS[key as usize])
                            }
                        })
                        .collect::<Vec<_>>()
                });
                let taken_by = if options.is_some() {
                    chest
                        .options
                        .iter()
                        .map(|o| match (o.taken, o.taken_by) {
                            (false, _) => BVal::text(""),
                            (true, Some(by)) if by == me.id => BVal::text(self_key.clone()),
                            (true, _) => BVal::text("?"),
                        })
                        .collect()
                } else {
                    Vec::new()
                };
                rows.push(BVal::Obj(vec![
                    ("id".into(), BVal::text(key)),
                    (
                        "x".into(),
                        BVal::num(f64::from(rh_protocol::quant::dequantize_pos(chest.x))),
                    ),
                    (
                        "y".into(),
                        BVal::num(f64::from(rh_protocol::quant::dequantize_pos(chest.y))),
                    ),
                    ("expiresAt".into(), BVal::num(chest.expires_at)),
                    (
                        "options".into(),
                        options.map_or(BVal::Null, |o| {
                            BVal::Arr(o.into_iter().map(BVal::text).collect())
                        }),
                    ),
                    ("takenBy".into(), BVal::Arr(taken_by)),
                    ("picked".into(), BVal::flag(chest.picked)),
                ]));
            }
            extras.push(("chests".to_string(), BVal::Arr(rows)));
        }
        if features.camps {
            let camps = frame
                .collections
                .camps
                .iter()
                .enumerate()
                .map(|(index, camp)| {
                    let type_name = camp
                        .mob_type
                        .checked_sub(1)
                        .and_then(|n| rh_sim::mob_catalog::MobTypeId::ALL.get(n as usize))
                        .map_or("", |t| t.as_str());
                    let mut fields = vec![
                        ("index".to_string(), BVal::num(index as f64)),
                        (
                            "id".to_string(),
                            BVal::text(
                                statics
                                    .camp_ids
                                    .get(index)
                                    .cloned()
                                    .unwrap_or_else(|| format!("camp{index}")),
                            ),
                        ),
                        ("type".to_string(), BVal::text(type_name)),
                        ("reward".to_string(), BVal::text("")),
                        ("alive".to_string(), BVal::num(f64::from(camp.alive))),
                        (
                            "state".to_string(),
                            BVal::num(f64::from(if camp.state <= 2 { camp.state } else { 0 })),
                        ),
                    ];
                    if camp.state == 2 {
                        fields.push(("respawnAt".to_string(), BVal::num(camp.respawn_at)));
                    }
                    BVal::Obj(fields)
                })
                .collect();
            extras.push(("camps".to_string(), BVal::Arr(camps)));
        }
        if features.status_effects {
            let mut effects = vec![(self_key.clone(), BVal::num(f64::from(me.effects)))];
            for a in frame.actors.iter().filter(|a| shown(a)) {
                effects.push((actor_key(a.id), BVal::num(f64::from(a.effects))));
            }
            extras.push(("effects".to_string(), BVal::Obj(effects)));
        }
        if features.fields {
            let rows = frame
                .collections
                .fields
                .iter()
                .map(|f| {
                    let ability = rh_sim::status_runtime::AbilityId::ALL
                        .get(f.ability as usize)
                        .map_or("", |a| a.as_str());
                    BVal::Obj(vec![
                        ("id".into(), BVal::Undefined),
                        (
                            "kind".into(),
                            BVal::text(*FIELD_KINDS.get(f.kind as usize).unwrap_or(&"")),
                        ),
                        ("ability".into(), BVal::text(ability)),
                        ("x".into(), BVal::num(f64::from(f.x))),
                        ("y".into(), BVal::num(f64::from(f.y))),
                        ("x2".into(), BVal::num(f64::from(f.x2))),
                        ("y2".into(), BVal::num(f64::from(f.y2))),
                        ("r".into(), BVal::num(f64::from(f.r))),
                        ("owner".into(), visible_id(f.owner)),
                        ("endsAt".into(), BVal::num(f.ends_at)),
                    ])
                })
                .collect();
            extras.push(("fields".to_string(), BVal::Arr(rows)));
        }

        let raw = BVal::Obj(vec![
            ("now".into(), BVal::num(now)),
            ("viewT".into(), BVal::num(now)),
            ("self".into(), self_record),
            ("hud".into(), hud),
            (
                "fighters".into(),
                BVal::Arr(fighters.into_iter().map(|f| f.0).collect()),
            ),
            (
                "mobs".into(),
                BVal::Arr(mobs.into_iter().map(|m| m.0).collect()),
            ),
            ("containers".into(), BVal::Arr(containers)),
            ("projectiles".into(), BVal::Arr(projectiles)),
            ("minimap".into(), minimap),
            ("events".into(), BVal::Arr(events)),
            ("extras".into(), BVal::Obj(extras)),
            ("features".into(), features_record(features)),
        ]);
        let percept = Percept {
            now,
            view_time: now,
            me_x: eye.x,
            me_y: eye.y,
            me_status: self_status.to_string(),
            me_faction: faction_of(me.faction),
            me_weapons: weapons.map(|w| w.and_then(decoded_weapon)),
            me_draw_started_at: draw_started_at,
            me_attack_target,
            hud_phase: phase.to_string(),
            hud_gates_locked: arena.gates_locked,
            hud_sudden_death_at: arena.sudden_death_at,
            has_toast,
            features: features.clone(),
            raw,
        };
        Some(Composed { percept, refs })
    }
}

/// The source feature record for the configured verdicts (message types in the source's own order).
pub(crate) fn features_record(f: &Features) -> BVal {
    BVal::Obj(vec![
        (
            "messageTypes".into(),
            BVal::Arr(
                f.message_types
                    .iter()
                    .map(|m| BVal::text(m.clone()))
                    .collect(),
            ),
        ),
        ("wishes".into(), BVal::flag(f.wishes)),
        ("statusEffects".into(), BVal::flag(f.status_effects)),
        ("fields".into(), BVal::flag(f.fields)),
        ("planning".into(), BVal::flag(f.planning)),
        ("chests".into(), BVal::flag(f.chests)),
        ("skills".into(), BVal::flag(f.skills)),
        ("relics".into(), BVal::flag(f.relics)),
        ("camps".into(), BVal::flag(f.camps)),
        ("hazards".into(), BVal::flag(f.hazards)),
    ])
}

/// The feature verdicts a server configuration offers a seat: the client message set the Brain may send, and which
/// runtime parts exist (abilities, the planning phase, chests and camps with mobs, statuses, areas, floor hazards).
pub(crate) fn configured_features(sim: &rh_sim::SimConfig, map: &TileMap) -> Features {
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

fn ai_name(ai: AiIntent) -> &'static str {
    match ai {
        AiIntent::Escape => "escape",
        AiIntent::Sustain => "sustain",
        AiIntent::Engage => "engage",
        AiIntent::Control => "control",
        AiIntent::Peel => "peel",
        AiIntent::Burst => "burst",
        AiIntent::Zone => "zone",
        AiIntent::Buff => "buff",
    }
}

fn blocked_name(b: BlockedBy) -> &'static str {
    match b {
        BlockedBy::Stun => "stun",
        BlockedBy::Silence => "silence",
        BlockedBy::Root => "root",
    }
}

/// The public Wish definition record (shared abilities.ts `AbilityDef` as the source percept carries it) from the
/// policy's own Wish table, which a parity test pins to the sim's definitions.
fn wish_def(ability: rh_sim::status_runtime::AbilityId) -> BVal {
    let Some(def) = WISHES.iter().find(|d| d.id == ability) else {
        return BVal::Null;
    };
    let targeting = match def.rank.targeting {
        TargetRule::Unit {
            range,
            los,
            snap_radius,
        } => BVal::Obj(vec![
            ("kind".into(), BVal::text("unit")),
            ("who".into(), BVal::text("enemy")),
            ("range".into(), BVal::num(range)),
            ("los".into(), BVal::flag(los)),
            ("snapRadius".into(), BVal::num(snap_radius)),
        ]),
        TargetRule::Point { range, min_range } => BVal::Obj(vec![
            ("kind".into(), BVal::text("point")),
            ("range".into(), BVal::num(range)),
            ("minRange".into(), BVal::num(min_range)),
        ]),
        TargetRule::Self_ => BVal::Obj(vec![("kind".into(), BVal::text("self"))]),
    };
    let effects = def
        .rank
        .effects
        .iter()
        .map(|e| match e {
            PolicyEffect::HidesCaster => BVal::Obj(vec![
                ("do".into(), BVal::text("status")),
                ("to".into(), BVal::text("self")),
                ("status".into(), BVal::text("hidden")),
            ]),
            PolicyEffect::Blink { max_dist, min_dist } => BVal::Obj(vec![
                ("do".into(), BVal::text("blink")),
                ("maxDist".into(), BVal::num(*max_dist)),
                ("minDist".into(), BVal::num(*min_dist)),
            ]),
        })
        .collect();
    BVal::Obj(vec![
        ("id".into(), BVal::text(ability.as_str())),
        ("name".into(), BVal::text(def.name)),
        (
            "ranks".into(),
            BVal::Arr(vec![BVal::Obj(vec![
                ("castMs".into(), BVal::num(def.rank.cast_ms)),
                ("targeting".into(), targeting),
                ("effects".into(), BVal::Arr(effects)),
            ])]),
        ),
        (
            "ai".into(),
            BVal::Arr(def.ai.iter().map(|a| BVal::text(ai_name(*a))).collect()),
        ),
        (
            "blockedBy".into(),
            BVal::Arr(
                def.blocked_by
                    .iter()
                    .map(|b| BVal::text(blocked_name(*b)))
                    .collect(),
            ),
        ),
    ])
}

/// The Brain's map record and projections over the match's public static map (`Arena` layers; a hand-built map has
/// none, so its camps, coliseum and regions are empty).
pub(crate) fn brain_map(arena: &rh_sim::Arena) -> super::config::BrainMap {
    use super::super::memory::{CampGeom, MemoryMap};
    use super::super::strategy::types::{CampDef, ColiseumDef, StrategyMap};
    use super::super::tactics::types::TacticsMap;
    let open = arena.map.clone();
    let locked = super::room_paths::with_gates(&open);
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
        raw: BVal::Obj(vec![
            ("w".into(), BVal::num(f64::from(open.w))),
            ("h".into(), BVal::num(f64::from(open.h))),
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

/// The public camp ids of the map, in camp order.
pub(crate) fn camp_ids(arena: &rh_sim::Arena) -> Vec<String> {
    arena.map.layers().map_or(Vec::new(), |layers| {
        layers.data().camps.iter().map(|c| c.id.clone()).collect()
    })
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

#[cfg(test)]
mod tests;
