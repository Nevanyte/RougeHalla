//! Checkpoints: `{format, content_hash, build, statics, world}` as JSON (or any serde format). The format tag is written first and refused
//! before the payload is interpreted, whatever order the keys arrive in, so a checkpoint of another layout (or none at all)
//! fails with a typed [`CheckpointError`] instead of an arbitrary serde error or a silently wrong state. Per-tick scratch is
//! never part of a checkpoint: a restored [`Sim`] starts with an empty [`TickScratch`] and behaves identically
//! (docs/CONTRACTS.md C-DET). A decoded [`Sim`] is complete (the map tables and the statics digest are built while
//! decoding); malformed or truncated input is an `Err`, never a panic.

use crate::constants::{TICK_MS, TILE};
use crate::content::WeaponId;
use crate::pathfind::Pathfinder;
use crate::scratch::TickScratch;
use crate::sim::Sim;
use crate::state::{ActionKind, World};
use crate::statics::MatchStatic;
use serde::de::value::{MapAccessDeserializer, MapDeserializer, SeqDeserializer};
use serde::de::{
    self, Deserialize, Deserializer, IgnoredAny, IntoDeserializer, MapAccess, Visitor,
};
use serde::ser::{SerializeStruct, Serializer};
use std::fmt;

/// The tag every checkpoint carries. Bump it when the layout of `statics` or `world` changes incompatibly.
pub const CHECKPOINT_FORMAT: &str = "rh-checkpoint/31";

/// How far past the map edge a fighter, waypoint or spawn may be and still restore (real states stay inside the map).
const COORD_MARGIN: f64 = 1024.0;

/// Why a checkpoint was refused.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CheckpointError {
    /// No `format` key: not a checkpoint, or one written before checkpoints were tagged.
    MissingFormat,
    /// A `format` this build does not read.
    UnsupportedFormat { found: String },
    /// The tag matched but the checkpoint was taken under other content (rules) than this build runs: restoring it would
    /// continue the match under different rules. A checkpoint without the key (written before it existed) is not checked.
    ContentMismatch { checkpoint: u64, build: u64 },
    /// The tag matched but the payload did not parse (or lacks `statics` / `world`).
    Malformed(String),
}

impl fmt::Display for CheckpointError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingFormat => write!(
                f,
                "checkpoint has no format tag (expected \"{CHECKPOINT_FORMAT}\")"
            ),
            Self::UnsupportedFormat { found } => write!(
                f,
                "unsupported checkpoint format \"{found}\" (expected \"{CHECKPOINT_FORMAT}\")"
            ),
            Self::ContentMismatch { checkpoint, build } => write!(
                f,
                "checkpoint was taken under content {checkpoint:016x}, this build runs {build:016x}"
            ),
            Self::Malformed(why) => write!(f, "malformed checkpoint: {why}"),
        }
    }
}

impl std::error::Error for CheckpointError {}

impl Sim {
    /// Restores a match from a checkpoint read through `d`, refusing any other format with a typed error.
    pub fn restore<'de, D: Deserializer<'de>>(d: D) -> Result<Sim, CheckpointError> {
        let mut why = None;
        match d.deserialize_struct("Checkpoint", FIELDS, CheckpointVisitor { why: &mut why }) {
            Ok(sim) => Ok(sim),
            Err(e) => Err(why.unwrap_or_else(|| CheckpointError::Malformed(e.to_string()))),
        }
    }
}

const FIELDS: &[&str] = &["format", "content_hash", "build", "statics", "world"];

impl serde::Serialize for Sim {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        if !self.w.pay.is_settled() {
            return Err(serde::ser::Error::custom(
                "checkpoint requires an empty same-tick payout queue",
            ));
        }
        let mut st = s.serialize_struct("Checkpoint", FIELDS.len())?;
        st.serialize_field("format", CHECKPOINT_FORMAT)?;
        st.serialize_field("content_hash", &crate::content::content_hash())?;
        st.serialize_field("build", crate::replay::BUILD_ID)?;
        st.serialize_field("statics", &self.k)?;
        st.serialize_field("world", &self.w)?;
        st.end()
    }
}

impl<'de> serde::Deserialize<'de> for Sim {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_struct("Checkpoint", FIELDS, CheckpointVisitor { why: &mut None })
    }
}

#[derive(serde::Deserialize)]
#[serde(field_identifier, rename_all = "lowercase")]
enum Key {
    Format,
    #[serde(rename = "content_hash")]
    ContentHash,
    Build,
    Statics,
    World,
    #[serde(other)]
    Other,
}

/// A part of the checkpoint: parsed at once when the tag is already known good, or held as a [`Buf`] until it is.
enum Part<T> {
    Typed(T),
    Held(Buf),
}

impl<T: for<'a> Deserialize<'a>> Part<T> {
    fn typed(self) -> Result<T, de::value::Error> {
        match self {
            Part::Typed(t) => Ok(t),
            Part::Held(b) => T::deserialize(b),
        }
    }
}

struct CheckpointVisitor<'a> {
    why: &'a mut Option<CheckpointError>,
}

impl CheckpointVisitor<'_> {
    /// Records the typed reason and returns the serde error that carries its message.
    fn refuse<E: de::Error>(self, why: CheckpointError) -> E {
        let e = E::custom(&why);
        *self.why = Some(why);
        e
    }
}

impl<'de> Visitor<'de> for CheckpointVisitor<'_> {
    type Value = Sim;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "a {CHECKPOINT_FORMAT} checkpoint")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Sim, A::Error> {
        let mut tagged = false;
        let mut content = None::<Part<u64>>;
        let (mut statics, mut world) = (None::<Part<MatchStatic>>, None::<Part<World>>);
        while let Some(key) = map.next_key::<Key>()? {
            match key {
                Key::Format => {
                    let found: String = map.next_value()?;
                    if found != CHECKPOINT_FORMAT {
                        return Err(self.refuse(CheckpointError::UnsupportedFormat { found }));
                    }
                    tagged = true;
                    // A `content_hash` read before the tag was only held: judged now, the typed reason wins over whatever
                    // the payload of another content's checkpoint fails on.
                    if let Some(held) = content.take() {
                        match held.typed() {
                            Ok(c) => {
                                if let Some(why) = content_mismatch(c) {
                                    return Err(self.refuse(why));
                                }
                            }
                            Err(e) => {
                                return Err(self.refuse(CheckpointError::Malformed(format!(
                                    "content_hash: {e}"
                                ))))
                            }
                        }
                    }
                }
                Key::ContentHash => {
                    // Checked as soon as it is read when the tag is known good (the real serialized order puts the tag
                    // first), so the typed reason wins over whatever the payload of another content's checkpoint fails on.
                    // Before the tag it is only held: another layout's `content_hash` need not even be a number.
                    if tagged {
                        let checkpoint: u64 = map.next_value()?;
                        if let Some(why) = content_mismatch(checkpoint) {
                            return Err(self.refuse(why));
                        }
                    } else {
                        content = Some(Part::Held(map.next_value()?));
                    }
                }
                // Informational: names the build that can verify this file; it is not compared (never verified across builds).
                Key::Build => {
                    map.next_value::<IgnoredAny>()?;
                }
                // Before the tag has been read a payload is only held (a stale layout must be refused by its tag, not by
                // whatever its payload happens to fail on); after it, it is parsed straight into its type.
                Key::Statics => {
                    statics = Some(if tagged {
                        Part::Typed(map.next_value()?)
                    } else {
                        Part::Held(map.next_value()?)
                    })
                }
                Key::World => {
                    world = Some(if tagged {
                        Part::Typed(map.next_value()?)
                    } else {
                        Part::Held(map.next_value()?)
                    })
                }
                Key::Other => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        if !tagged {
            return Err(self.refuse(CheckpointError::MissingFormat));
        }
        let (Some(k), Some(w)) = (statics, world) else {
            return Err(self.refuse(CheckpointError::Malformed(
                "missing `statics` or `world`".into(),
            )));
        };
        let (k, mut w) = match (k.typed(), w.typed()) {
            (Ok(k), Ok(w)) => (k, w),
            (Err(e), _) | (_, Err(e)) => {
                return Err(self.refuse(CheckpointError::Malformed(e.to_string())))
            }
        };
        if let Err(why) = check_world(&k, &w) {
            return Err(self.refuse(CheckpointError::Malformed(why)));
        }
        if let Err(why) = crate::systems::frost::prepare(&k, &mut w) {
            return Err(self.refuse(CheckpointError::Malformed(why.into())));
        }
        let mut scratch = TickScratch::default();
        scratch.reserve_actors(w.fighter_count());
        if let Err(why) = crate::systems::sentenced::prepare(&k, &mut w, &mut scratch) {
            return Err(self.refuse(CheckpointError::Malformed(why.into())));
        }
        let mut projection = crate::fx_report::Projection::empty_at(w.tick);
        projection.prepare_mobs(w.mobs.len());
        // Cold Card preparation rebuilds the derived trusted pair index from the validated rows and reserves the
        // exact sidecars/public bounds for this accepted state; a state the representation cannot prepare is
        // refused here instead of silently under-reserving the first step.
        if let Err(why) =
            crate::systems::card_bleed_feedback::prepare(&k, &mut w, &mut scratch, &mut projection)
        {
            return Err(self.refuse(CheckpointError::Malformed(why)));
        }
        Ok(Sim {
            projection,
            k,
            w,
            s: scratch,
            pf: Pathfinder::default(),
        })
    }
}

fn content_mismatch(checkpoint: u64) -> Option<CheckpointError> {
    let build = crate::content::content_hash();
    (checkpoint != build).then_some(CheckpointError::ContentMismatch { checkpoint, build })
}

/// A projectile starts with its faction's weapon damage. Reflections, interceptions and arrow
/// deletions only reduce it. Check pending ranged packets too, before they can become a flight.
pub(crate) fn valid_ranged_packet(packet: crate::state::Packet, weapon: WeaponId) -> bool {
    let maximum = crate::modifiers::maximum_packet(weapon);
    let shares = [packet.phys, packet.magic, packet.true_];
    (0.0..=maximum).contains(&packet.raw)
        && shares.iter().all(|v| (0.0..=1.0).contains(v))
        && (shares.iter().sum::<f64>() - 1.0).abs() <= 4.0 * f64::EPSILON
}

/// The invariants the tick relies on and the serde shape cannot express. A state that breaks one would panic (or silently
/// misbehave) a few steps later, so a checkpoint carrying it is refused here instead.
fn archetype_ok(
    got: crate::archetype::ArchetypeId,
    want: crate::archetype::ArchetypeId,
) -> Result<(), String> {
    if got.get().is_none() {
        return Err(format!("unknown hitbox archetype {}", got.0));
    }
    if got != want {
        return Err(format!(
            "hitbox archetype {} differs from the assigned {}",
            got.0, want.0
        ));
    }
    Ok(())
}

fn check_world(k: &MatchStatic, w: &World) -> Result<(), String> {
    // Validate actor classes before any player-only facade or faction/brain consumer can run.
    if w.players.iter().any(|p| p.core.faction_id().is_none()) {
        return Err("neutral player affiliation".into());
    }
    for m in &w.mobs {
        if m.kind == crate::mob_runtime::MobKind::QuestGiver {
            continue;
        }
        if m.core.faction_id().is_none() {
            return Err("unsupported neutral actor class".into());
        }
        if (m.kind == crate::mob_runtime::MobKind::Dummy
            && m.core.faction_id() != Some(crate::FactionId::Fire))
            || (m.zombie.is_some() && m.core.faction_id() != Some(crate::FactionId::Plague))
        {
            return Err("actor affiliation class mismatch".into());
        }
        let regional = m.zombie.is_none()
            && matches!(
                m.kind,
                crate::mob_runtime::MobKind::Regional | crate::mob_runtime::MobKind::Practice
            );
        if regional != m.brain.is_some() {
            return Err("actor brain capability mismatch".into());
        }
    }
    // ADR0024: every fighter's hitbox row is the one its constructor assigns for this match's mode and identity.
    for p in &w.players {
        let want = crate::archetype::assign(
            k.config.hitboxes,
            crate::archetype::Identity::Player(p.core.vitals.faction),
        );
        archetype_ok(p.core.archetype, want)?;
    }
    for m in &w.mobs {
        let identity = m.identity().ok_or("actor lacks a hitbox identity")?;
        archetype_ok(
            m.core.archetype,
            crate::archetype::assign(k.config.hitboxes, identity),
        )?;
    }
    crate::quests::giver::validate(k, w)?;
    crate::systems::arena_validation::validate(k, w)?;
    crate::systems::planning::validate(k, w)?;
    crate::quests::live::validate(k, w)?;
    crate::traders::runtime::validate(k, w)?;
    // Every coordinate the kernel will read must be a real place near the arena: a huge or non-finite one overflows the
    // tile arithmetic of the next path request (debug panic, release wrap), and two huge opposite ones cancel in a
    // finiteness sum.
    let lo = -COORD_MARGIN;
    let hi_x = k.arena.map.w as f64 * TILE + COORD_MARGIN;
    let hi_y = k.arena.map.h as f64 * TILE + COORD_MARGIN;
    let near = |x: f64, y: f64| (lo..=hi_x).contains(&x) && (lo..=hi_y).contains(&y);
    for s in &k.arena.spawns {
        if !near(s.x, s.y) {
            return Err(format!("spawn ({}, {}) is outside the arena", s.x, s.y));
        }
        if k.arena.map.layers().is_some()
            && !crate::geometry::circle_clear(
                &k.arena.map,
                *s,
                crate::constants::PLAYER_RADIUS,
                crate::constants::MASK_MOVE,
            )
        {
            return Err(format!(
                "spawn ({}, {}) is not walkable on the layered arena",
                s.x, s.y
            ));
        }
    }
    // The counters the tick increments cannot be past what the match could have produced: the roster holds everyone who
    // ever joined, a join adds one, a kill needs a victim and a down needs a fighter.
    let joined_ever = w.roster.len();
    let mut corpse_players = std::collections::BTreeSet::new();
    for c in &w.plague_corpses {
        if !corpse_players.insert(c.player)
            || w.roster.name(c.player).is_none()
            || w.player(c.player)
                .is_some_and(|p| p.status != crate::Status::Dead)
            || !near(c.x, c.y)
        {
            return Err("invalid Plague corpse state".into());
        }
    }
    if w.joined > joined_ever {
        return Err(format!(
            "joined {} exceeds the roster of {joined_ever}",
            w.joined
        ));
    }
    if w.rt.downs_between_ticks as usize > joined_ever {
        return Err(format!(
            "downs_between_ticks {} exceeds the roster of {joined_ever}",
            w.rt.downs_between_ticks
        ));
    }
    // `next_id` hands out the next join: at or below a present or past id it would push out of order (a panic).
    let ceiling = w
        .players
        .last()
        .map(|p| p.id)
        .into_iter()
        .chain(w.roster.last_id())
        .chain(w.actor_history.last().map(|a| a.id))
        .max();
    if let Some(last) = ceiling {
        if w.next_id <= last.0 {
            return Err(format!(
                "next_id {} is not greater than the last player or roster id {}",
                w.next_id, last.0
            ));
        }
    }
    // A raid transition or a respawn can create an entire camp batch before the next
    // validation. Reserve every admitted camp spot conservatively, plus the next join.
    // Current corpses/camp state are not a bound on future births.
    let quest_births = if k.config.quests {
        u64::from(crate::constants::QUEST_COUNT)
    } else {
        0
    };
    let potential_births = quest_births
        + if k.config.mob_mode == crate::mob_runtime::MobMode::Off {
            0
        } else {
            k.arena.map.layers().map_or(0, |layers| {
                layers
                    .data()
                    .camps
                    .iter()
                    .map(|c| c.spots.len() as u64)
                    .sum::<u64>()
            })
        };
    if u64::from(w.next_id) + potential_births + 1 > u64::from(u32::MAX) {
        return Err("next_id lacks headroom for camp births and the next join".into());
    }
    // Roster order is checked by its own decoder and player order by the store's.
    // The clock must stay where `+= TICK_MS` and the rewind cutoff are exact (the most the tick counter can reach); far
    // beyond it the additions are absorbed, no sample is ever trimmed and the history ring fills.
    if !(0.0..=u32::MAX as f64 * TICK_MS).contains(&w.server_time) {
        return Err(format!(
            "server_time {} is outside 0..={}",
            w.server_time,
            u32::MAX as f64 * TICK_MS
        ));
    }
    // The trusted Card report and any serialized server-only raw Card rows must be a coherent, canonically
    // valid B3 state: actual retained actor provenance, unique complete raw pairs and report clock/state
    // invariants. The typed amount deserializer already rejected tags/payloads/finite-domain violations.
    w.card_bleed
        .validate(w.server_time, &|id| w.known_actor(id))?;
    // Between-step cancellation is queued before the next clock advance. Its required producer time must survive
    // restore verbatim; accepting a default or a future/nonfinite value would fabricate the eventual public cue time.
    for (i, event) in w.pending_events.iter().enumerate() {
        if let crate::Event::CardBleedHit { victim, by, .. } = event {
            for id in [Some(*victim), *by].into_iter().flatten() {
                if !w.known_actor(id) {
                    return Err(format!(
                        "pending CardBleedHit {i}: actor {} has no retained provenance",
                        id.0
                    ));
                }
            }
        }
        let event_time = match event {
            crate::Event::CastStarted { event_time, .. }
            | crate::Event::CastLanded { event_time, .. }
            | crate::Event::CastEnded { event_time, .. } => *event_time,
            _ => continue,
        };
        if !event_time.is_finite() || !(0.0..=w.server_time).contains(&event_time) {
            return Err(format!(
                "pending Wish event {i}: event_time is not a finite past server time"
            ));
        }
    }
    // The tick counter is incremented every step.
    if w.tick == u32::MAX {
        return Err("tick is at its maximum".into());
    }
    let mut last_container = 0;
    let mut item_ids = std::collections::BTreeSet::new();
    let per_seat = crate::constants::MAX_ACTIONS_PER_TICK as u64
        + 1
        + u64::from(crate::constants::MAX_ARROW_REFLECTIONS);
    // Seeded rack props can be numerous. Each consumed ground prop needed one action; each
    // launched shot and its entire reflection chain needed an attack. These account for all
    // entity ids no longer represented by current containers in this build.
    let quest_allocations = if k.config.quests {
        u64::from(crate::constants::QUEST_COUNT) * 2
            + crate::quests::catalog::DEFINITION
                .iter()
                .map(|d| {
                    u64::from(d.token_spawns) + u64::from(d.kind == crate::quests::Kind::Fetch)
                })
                .sum::<u64>()
    } else {
        0
    };
    let max_allocated = quest_allocations
        + ((w.containers.len() + w.reward_chests.len()) as u64
            + w.actor_history
                .iter()
                .filter(|a| matches!(a.origin, crate::mob_runtime::ActorOrigin::Mob { .. }))
                .count() as u64)
            .saturating_add(
                u64::from(w.tick)
                    .saturating_mul(w.actor_history.len() as u64)
                    .saturating_mul(per_seat),
            );
    if u64::from(w.entity_counter) > max_allocated
        || w.item_counter
            > u64::from(w.entity_counter) * (2 + u64::from(crate::potions::DEFINITION.cap))
    {
        return Err("invalid run entity identity counters".into());
    }
    // Keep enough ids for a full step of inputs, shots, drops and body creation, PLUS every
    // additional reflection the existing arrows could make. An imported dense volley must
    // never panic at the shield that reflects it.
    let mut needed_ids = potential_births
        + (w.fighter_count() as u64 + potential_births)
            * (2 * crate::constants::MAX_ACTIONS_PER_TICK as u64);
    for c in &w.containers {
        if c.id <= last_container
            || c.id > w.entity_counter
            || !near(c.at.x, c.at.y)
            || c.born_tick > w.tick.saturating_add(1)
            || c.items.len() > 2 + usize::from(crate::potions::DEFINITION.cap)
            || (c.kind == crate::ContainerKind::Ground
                && (c.items.len() != 1
                    || !matches!(c.items[0].def, crate::initial_world::ItemDef::Weapon(_))))
            || (c.kind != crate::ContainerKind::Chest && c.opened)
            || (c.kind == crate::ContainerKind::WindEmblem && !c.items.is_empty())
            || matches!(c.kind, crate::ContainerKind::Body(id) if w.roster.name(id).is_none())
            || (c.kind == crate::ContainerKind::Cannon
                && (c.opened
                    || !c.items.is_empty()
                    || c.target.is_none_or(|t| !near(t.x, t.y))
                    || !c.ready_at.is_finite()
                    || !(0.0..=u32::MAX as f64).contains(&c.ready_at)))
            || (c.kind != crate::ContainerKind::Cannon && (c.target.is_some() || c.ready_at != 0.0))
        {
            return Err(format!("invalid container {}", c.id));
        }
        last_container = c.id;
        for item in &c.items {
            if item.def == crate::initial_world::ItemDef::Weapon(WeaponId::Fists)
                || item.uid == 0
                || item.uid > w.item_counter
                || !item_ids.insert(item.uid)
            {
                return Err(format!("invalid item in container {}", c.id));
            }
        }
    }
    let mut last_projectile = 0;
    for pr in &w.projectiles {
        let st = &pr.launch;
        let weapon = if st.kind == crate::ProjectileKind::Ball {
            WeaponId::Wand
        } else {
            WeaponId::Bow
        };
        let crate::content::Shape::Projectile { speed, range } =
            crate::content::weapon(weapon).shape
        else {
            unreachable!()
        };
        // One entity counter supplies props and missiles; no id can be reused. Settled flights have
        // reached the checkpoint clock. They may still belong to a fighter who has since departed.
        let velocity_ok =
            |v: crate::Vec2| (crate::math::hypot(v.x, v.y) - speed).abs() <= speed * 1e-10;
        if w.phase != crate::Phase::Active
            || st.id <= last_projectile
            || st.id > w.entity_counter
            || w.containers.binary_search_by_key(&st.id, |c| c.id).is_ok()
            || !w.known_actor(st.owner)
            || st
                .target
                .is_some_and(|id| weapon != WeaponId::Wand || !w.known_actor(id) || id == st.owner)
            || st.reflected != (pr.reflections > 0)
            || pr.reflections > crate::constants::MAX_ARROW_REFLECTIONS
            || (st.reflected && weapon != WeaponId::Bow)
            || (pr.halved && weapon != WeaponId::Wand)
            // ADR0024 (review finding 4): a height this match's mode can produce, so a restored flight never meets,
            // homes or projects differently from one the tick launched.
            || !crate::archetype::valid_height(k.config.hitboxes, st.height)
            || !(0. ..=range).contains(&st.range)
            || !(0. ..=st.range).contains(&pr.traveled)
            || !near(st.origin.x, st.origin.y)
            || !near(pr.pos.x, pr.pos.y)
            || !(0. ..=pr.time).contains(&st.time)
            || pr.time != w.server_time
            || !velocity_ok(st.velocity)
            || !velocity_ok(pr.velocity)
            || !valid_ranged_packet(pr.packet, weapon)
            // A Fire seat's armed attack can launch the flight; a departed owner's flag is unreachable for the burst
            // because the source consults only present players.
            || (pr.roam_armed
                && w
                    .player(st.owner)
                    .is_some_and(|p| p.faction() != crate::FactionId::Fire))
        {
            return Err(format!("invalid projectile {}", st.id));
        }
        if weapon == WeaponId::Bow {
            needed_ids += u64::from(crate::constants::MAX_ARROW_REFLECTIONS - pr.reflections);
        }
        last_projectile = st.id;
    }
    if u64::from(w.entity_counter) + needed_ids > u64::from(u32::MAX) {
        return Err("insufficient run entity identity headroom".into());
    }
    crate::systems::mobs::validate(k, w, near)?;
    crate::status_runtime::checkpoint::validate_world(w, near)?;
    crate::abilities::checkpoint::validate(k, w)?;
    crate::systems::initial_loot::validate(k, w)?;
    crate::systems::potions::validate(w)?;
    crate::reward_chests::validate_world(w, near)?;
    crate::terrain::validate(k, w, near)?;
    for e in &w.deferred.hits {
        if (e.execute && e.sig != Some(crate::factions::SignatureKind::Disease))
            || e.sig.is_some_and(|s| !k.config.faction_mode.supports(s))
        {
            return Err(
                "deferred signature requires its producer mode and execute qualification".into(),
            );
        }
    }
    crate::systems::sentenced::mark_tax::validate(k, w)?;
    if !(0.0..=w.server_time).contains(&w.factions.dot_since)
        || (!k.config.faction_mode.engagement()
            && w.factions != crate::factions::FactionRuntime::default())
        || (!k.config.faction_mode.plague() && !w.factions.dot.is_empty())
        || w.factions.dot.len()
            > 2usize
                .saturating_mul(w.actor_history.len().max(w.roster.len()))
                .saturating_mul(w.actor_history.len().max(w.roster.len()))
    {
        return Err("invalid faction runtime".into());
    }
    for (i, b) in w.factions.dot.iter().enumerate() {
        if !b.sig.is_dot()
            || (b.sig == crate::factions::SignatureKind::Burn && !k.config.faction_mode.fire())
            || !b.amount.is_finite()
            || !(b.amount > 0.0)
            || b.by == b.victim
            || !w.known_actor(b.by)
            || !w.known_actor(b.victim)
            || w.factions.dot[..i]
                .iter()
                .any(|a| (a.by, a.victim, a.sig) == (b.by, b.victim, b.sig))
        {
            return Err("invalid private DoT bucket".into());
        }
    }
    for p in w.players.iter() {
        // Shape only: zero hints and zeroAll retain the previous direction byte.
        if p.walk_ticks > crate::constants::WALK_HINT_MAX_TICKS {
            return Err(format!("player {}: invalid walk hint ticks", p.id.0));
        }
        // Locked history becomes admissible with the complete Source arena lifecycle.
        p.vision.check(
            w.tick,
            k.config.lifecycle.rules().is_some() && w.raid_started_at > 0.,
            near,
        )?;
        if p.hunt_target().is_some_and(|id| {
            id == p.id
                || w.phase != crate::Phase::Active
                || !p.standing()
                || w.player(id).is_none_or(|target| !target.standing())
        }) || p.hunt_stacks as usize > joined_ever
        {
            return Err(format!("player {}: invalid Sentenced hunt state", p.id.0));
        }
        let sig = &p.signature;
        crate::systems::sentenced::validate(k, w, p)?;
        super::systems::signatures::validate_basic(k, w, p.id, sig)?;
        // The Fire roam clock is set at raid start or by positive damage dealt/taken; it is never future-dated. The
        // armed flag arms only a Fire seat's burst but is independent of the clock, so it is not coupled here.
        if p.roam
            .last_combat_at
            .is_some_and(|t| !(0.0..=w.server_time).contains(&t))
        {
            return Err(format!("player {}: invalid Fire roam state", p.id.0));
        }
        let lock = &p.weapon.targeting;
        let valid_foe = |id: crate::PlayerId| id != p.id && w.known_actor(id);
        let valid_time = |t: f64| (0.0..=w.server_time).contains(&t);
        if lock.target.is_some_and(|id| {
            !valid_foe(id)
                || w.phase != crate::Phase::Active
                || !p.standing()
                || p.active_weapon() != WeaponId::Wand
        }) || (lock.target.is_none() && (lock.seen || lock.goal.is_some()))
            || (lock.goal.is_some() && lock.plan_at.is_none())
            || (lock.lost_at.is_some() && !lock.seen)
            || [lock.lost_at, lock.plan_at, lock.search_at]
                .into_iter()
                .flatten()
                .any(|t| !valid_time(t))
            || lock.goal.is_some_and(|g| !near(g.x, g.y))
            || lock.attack_move.is_some_and(|g| {
                !(0.0..=crate::constants::WORLD_W).contains(&g.x)
                    || !(0.0..=crate::constants::WORLD_H).contains(&g.y)
            })
            || p.weapon.action.is_some_and(|a| {
                a.target
                    .is_some_and(|id| a.weapon != WeaponId::Wand || !valid_foe(id))
            })
        {
            return Err(format!("invalid target lock state for player {}", p.id.0));
        }
        if !p.bush.check(w.server_time, w.phase) {
            return Err(format!("invalid bush exposure for player {}", p.id.0));
        }
        // The regeneration clock is a time the tick wrote: a future-dated one would make the fighter permanently
        // in-combat, and a non-finite one makes the quiet-window comparison meaningless.
        if p.regen_at.is_some_and(|t| !valid_time(t)) {
            return Err(format!(
                "player {}: regeneration clock is not a past server time",
                p.id.0
            ));
        }
        // A wind boost is a deadline at most one boost length ahead; anything else would never expire sanely.
        if !p.speed_boost_until.is_finite()
            || !(0.0..=w.server_time + crate::constants::SPEED_BOOST_MS)
                .contains(&p.speed_boost_until)
        {
            return Err(format!("player {}: invalid speed boost deadline", p.id.0));
        }
        // The private G6 barrier timer is a finite, nonnegative clock, and the decay flag cannot stand without one.
        // The barrier itself is finite and nonnegative but intentionally has NO universal cap: the source clamps only
        // at grant time, so a later max-hp decrease can leave a larger barrier standing until decay or a new grant.
        if !p.barrier_until.is_finite()
            || p.barrier_until < 0.
            || (p.barrier_decays && !(p.barrier_until > 0.))
            || !p.vitals.barrier.is_finite()
            || p.vitals.barrier < 0.
        {
            return Err(format!("player {}: invalid G6 barrier state", p.id.0));
        }
        // Samples are appended in time order and never dated after the clock: a future-dated one is never trimmed and
        // fills the ring.
        if !near(p.body.x, p.body.y) {
            return Err(format!(
                "player {}: body at ({}, {}) is outside the arena",
                p.id.0, p.body.x, p.body.y
            ));
        }
        if let Some(q) = p.motion.path.as_slice().iter().find(|q| !near(q.x, q.y)) {
            return Err(format!(
                "player {}: path point ({}, {}) is outside the arena",
                p.id.0, q.x, q.y
            ));
        }
        if p.credit.bot_kills > p.credit.kills || p.credit.kills as usize > joined_ever {
            return Err(format!(
                "player {}: {} kills of which {} bots, with {joined_ever} ever joined",
                p.id.0, p.credit.kills, p.credit.bot_kills
            ));
        }
        // Samples are appended one tick apart at least (a trim keeps the ring within its window only then); closer ones
        // fill the ring within a few steps. The gap test also covers time order. The one source shape with equal times
        // is a displacement during the actions phase (a Blaze charge, a travel-cannon blast) that resets the history and
        // is followed by the movement phase appending the same tick's final sample: the source keeps both and readers
        // clamp, so only the first pair may share its timestamp.
        let h = p.body.history.as_slice();
        if h.windows(2).enumerate().any(|(i, s)| {
            !(s[1].t >= s[0].t + TICK_MS)
                && !(i == 0
                    && (h[0].t == h[1].t || crate::abilities::checkpoint::blaze_history(k, p)))
        }) {
            return Err(format!(
                "player {}: rewind history is not in time order, a tick apart",
                p.id.0
            ));
        }
        if let Some(q) = h.iter().find(|q| !near(q.x, q.y)) {
            return Err(format!(
                "player {}: rewind sample ({}, {}) is outside the arena",
                p.id.0, q.x, q.y
            ));
        }
        if let Some(l) = h.last() {
            if !(l.t <= w.server_time) {
                return Err(format!(
                    "player {}: rewind history ends at {}, after server_time {}",
                    p.id.0, l.t, w.server_time
                ));
            }
        }
        if p.weapon.slot > 1
            || [p.weapon.weapon0, p.weapon.weapon1].contains(&Some(WeaponId::Fists))
        {
            return Err(format!("player {}: invalid carried weapon or slot", p.id.0));
        }
        // Frost's Frozen Justice guard: only a live Frost seat in an active run may hold the clock, the clock never
        // outlives its own linger, and the synced flag is exactly the clock's answer on every other seat.
        let guard = &p.frost_guard;
        let passive_seat = p.faction() == crate::FactionId::Frost
            && p.status == crate::state::Status::Alive
            && w.phase == crate::Phase::Active;
        if guard.until.is_some_and(|t| {
            !(0.0..=w.server_time + crate::constants::FROST_ELITE_GUARD_LINGER_MS).contains(&t)
        }) || (!passive_seat && (guard.active || guard.until.is_some()))
            || (passive_seat && guard.active != guard.until.is_some_and(|t| t > w.server_time))
        {
            return Err(format!(
                "player {}: invalid Frost elite guard state",
                p.id.0
            ));
        }
        if !p.modifiers.valid(
            &p.build,
            &p.farm,
            &p.kill_stats,
            &p.trade_stats,
            crate::modifiers::ValidationOwner {
                base_hp: crate::content::faction(p.faction()).hp,
                faction: p.faction(),
                frozen_guard: passive_seat && guard.active,
            },
        ) {
            return Err(format!("player {}: invalid armor mirror", p.id.0));
        }
        if !p.kill_stats.valid() {
            return Err(format!("player {}: invalid kill-augment stats", p.id.0));
        }
        crate::status_runtime::validate(&p.statuses, w.server_time)
            .map_err(|reason| format!("player {}: invalid status runtime: {reason}", p.id.0))?;
        for st in &p.statuses.instances {
            if [st.source.id, st.source.owner_id]
                .into_iter()
                .flatten()
                .any(|id| !w.known_actor(id))
            {
                return Err(format!(
                    "player {}: status source has no player provenance",
                    p.id.0
                ));
            }
        }
        if let Some(a) = p.weapon.action {
            let pk = a.packet;
            let finite = [
                a.started_at,
                a.lands_at,
                a.a,
                pk.raw,
                pk.phys,
                pk.magic,
                pk.true_,
            ]
            .iter()
            .all(|v| v.is_finite());
            let expected = match a.weapon {
                WeaponId::Bow => ActionKind::Draw,
                WeaponId::Wand => ActionKind::Cast,
                _ => ActionKind::Swing,
            };
            if a.kind != expected
                || a.weapon != p.active_weapon()
                || !finite
                || (a.kind != ActionKind::Swing && !valid_ranged_packet(pk, a.weapon))
                || a.lands_at < a.started_at
                || (a.roam_armed && p.faction() != crate::FactionId::Fire)
            {
                return Err(format!(
                    "player {}: pending {:?} action with {:?} (or a non-finite value)",
                    p.id.0, a.kind, a.weapon
                ));
            }
        }
        p.core
            .inputs
            .check()
            .map_err(|e| format!("player {}: {e}", p.id.0))?;
    }
    Ok(())
}

/// A self-describing value held while a checkpoint's tag is still unread (serde_json's `Value`, in miniature), which then
/// deserializes into the real type. Only used when a payload key precedes `format`; checkpoints this build writes never do.
enum Buf {
    Unit,
    Bool(bool),
    I64(i64),
    U64(u64),
    F64(f64),
    Str(String),
    Seq(Vec<Buf>),
    Map(Vec<(Buf, Buf)>),
}

impl<'de> Deserialize<'de> for Buf {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_any(BufVisitor)
    }
}

struct BufVisitor;

impl<'de> Visitor<'de> for BufVisitor {
    type Value = Buf;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("any value")
    }
    fn visit_bool<E>(self, v: bool) -> Result<Buf, E> {
        Ok(Buf::Bool(v))
    }
    fn visit_i64<E>(self, v: i64) -> Result<Buf, E> {
        Ok(Buf::I64(v))
    }
    fn visit_u64<E>(self, v: u64) -> Result<Buf, E> {
        Ok(Buf::U64(v))
    }
    fn visit_f64<E>(self, v: f64) -> Result<Buf, E> {
        Ok(Buf::F64(v))
    }
    fn visit_str<E>(self, v: &str) -> Result<Buf, E> {
        Ok(Buf::Str(v.to_owned()))
    }
    fn visit_string<E>(self, v: String) -> Result<Buf, E> {
        Ok(Buf::Str(v))
    }
    fn visit_unit<E>(self) -> Result<Buf, E> {
        Ok(Buf::Unit)
    }
    fn visit_none<E>(self) -> Result<Buf, E> {
        Ok(Buf::Unit)
    }
    fn visit_some<D: Deserializer<'de>>(self, d: D) -> Result<Buf, D::Error> {
        Buf::deserialize(d)
    }
    fn visit_seq<A: de::SeqAccess<'de>>(self, mut a: A) -> Result<Buf, A::Error> {
        let mut v = Vec::with_capacity(a.size_hint().unwrap_or(0).min(4096));
        while let Some(x) = a.next_element()? {
            v.push(x);
        }
        Ok(Buf::Seq(v))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Buf, A::Error> {
        let mut v = Vec::with_capacity(a.size_hint().unwrap_or(0).min(4096));
        while let Some(kv) = a.next_entry()? {
            v.push(kv);
        }
        Ok(Buf::Map(v))
    }
}

impl<'de> IntoDeserializer<'de, de::value::Error> for Buf {
    type Deserializer = Buf;
    fn into_deserializer(self) -> Buf {
        self
    }
}

impl<'de> Deserializer<'de> for Buf {
    type Error = de::value::Error;

    fn deserialize_any<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Self::Error> {
        match self {
            Buf::Unit => v.visit_unit(),
            Buf::Bool(b) => v.visit_bool(b),
            Buf::I64(n) => v.visit_i64(n),
            Buf::U64(n) => v.visit_u64(n),
            Buf::F64(n) => v.visit_f64(n),
            Buf::Str(s) => v.visit_string(s),
            Buf::Seq(x) => SeqDeserializer::new(x.into_iter()).deserialize_any(v),
            Buf::Map(m) => MapDeserializer::new(m.into_iter()).deserialize_any(v),
        }
    }

    fn deserialize_option<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Self::Error> {
        match self {
            Buf::Unit => v.visit_none(),
            other => v.visit_some(other),
        }
    }

    fn deserialize_newtype_struct<V: Visitor<'de>>(
        self,
        _: &'static str,
        v: V,
    ) -> Result<V::Value, Self::Error> {
        v.visit_newtype_struct(self)
    }

    fn deserialize_enum<V: Visitor<'de>>(
        self,
        _: &'static str,
        _: &'static [&'static str],
        v: V,
    ) -> Result<V::Value, Self::Error> {
        match self {
            Buf::Str(s) => v.visit_enum(s.into_deserializer()),
            Buf::Map(m) if m.len() == 1 => v.visit_enum(MapAccessDeserializer::new(
                MapDeserializer::new(m.into_iter()),
            )),
            _ => Err(de::Error::custom("expected an enum")),
        }
    }

    serde::forward_to_deserialize_any! {
        bool i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 char str string bytes byte_buf unit unit_struct
        seq tuple tuple_struct map struct identifier ignored_any
    }
}

#[cfg(test)]
mod tests {
    use super::{CheckpointError, CHECKPOINT_FORMAT};
    use crate::arenas::practice_arena;
    use crate::constants::TICK_MS;
    use crate::content::FactionId;
    use crate::math::Vec2;
    use crate::sim::{Event, Placement, PlayerId, Secrets, Sim, SimConfig};

    fn sim() -> Sim {
        let ps = [
            Placement {
                profile: "a".into(),
                faction: FactionId::Holy,
                bot: false,
                at: Vec2::new(200.0, 200.0),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "b".into(),
                faction: FactionId::Fire,
                bot: false,
                at: Vec2::new(600.0, 600.0),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
            Placement {
                profile: "c".into(),
                faction: FactionId::Frost,
                bot: false,
                at: Vec2::new(900.0, 300.0),
                hp: None,
                weapon0: None,
                weapon1: None,
            },
        ];
        Sim::reset_active(
            SimConfig::default(),
            practice_arena(),
            Secrets::from_seed(5),
            &ps,
        )
    }

    #[test]
    fn a_checkpoint_keeps_results_emitted_between_steps() {
        let mut a = sim();
        a.step();
        a.remove_player(PlayerId(3)); // a leave between steps: its MIA result waits for the next step
        let mut b: Sim = serde_json::from_str(&serde_json::to_string(&a).unwrap()).unwrap();
        assert_eq!(a.state_hash(), b.state_hash());
        let (ea, eb) = (a.step(), b.step());
        let resolved = |e: &Vec<Event>| {
            e.iter()
                .filter(|e| matches!(e, Event::Resolved { .. }))
                .count()
        };
        assert_eq!(resolved(&ea), 1);
        assert_eq!(
            resolved(&eb),
            1,
            "the restored sim still delivers the leave's result"
        );
        assert_eq!(a.state_hash(), b.state_hash());
    }

    #[test]
    fn a_checkpoint_is_tagged_and_restores_complete() {
        let mut a = sim();
        for _ in 0..30 {
            a.step();
        }
        let json = serde_json::to_value(&a).unwrap();
        assert_eq!(json["format"], CHECKPOINT_FORMAT);
        assert!(json["statics"].is_object() && json["world"].is_object());
        // The tag leads the document, so a stale layout is refused before its payload is parsed.
        assert!(serde_json::to_string(&a)
            .unwrap()
            .starts_with(&format!("{{\"format\":\"{CHECKPOINT_FORMAT}\"")));
        let mut b = Sim::restore(&json).expect("restores");
        assert_eq!(a.state_hash(), b.state_hash());
        for _ in 0..60 {
            a.step();
            b.step();
        }
        assert_eq!(a.state_hash(), b.state_hash());
    }

    #[test]
    fn a_mismatched_format_tag_is_refused_with_a_typed_error() {
        let mut json = serde_json::to_value(sim()).unwrap();
        json["format"] = "rh-checkpoint/0".into();
        assert_eq!(
            Sim::restore(&json).err(),
            Some(CheckpointError::UnsupportedFormat {
                found: "rh-checkpoint/0".into()
            })
        );
        // Through plain serde the same refusal arrives as the error message.
        let err = serde_json::from_value::<Sim>(json).unwrap_err().to_string();
        assert!(err.contains("unsupported checkpoint format"), "{err}");
        // The previous layout (no roster, String winners) is refused by its tag, not as a serde error.
        let mut old = serde_json::to_value(sim()).unwrap();
        old["format"] = "rh-checkpoint/1".into();
        assert_eq!(
            Sim::restore(&old).err(),
            Some(CheckpointError::UnsupportedFormat {
                found: "rh-checkpoint/1".into()
            })
        );
        // The layout before the fighter components (flat player records) is refused by its tag too, and a payload that
        // still carries the old nesting under the new tag is malformed, not a silently wrong state.
        let mut flat = serde_json::to_value(sim()).unwrap();
        flat["format"] = "rh-checkpoint/2".into();
        assert_eq!(
            Sim::restore(&flat).err(),
            Some(CheckpointError::UnsupportedFormat {
                found: "rh-checkpoint/2".into()
            })
        );
        let mut retagged = serde_json::to_value(sim()).unwrap();
        retagged["world"]["players"] = serde_json::json!([{"id": 1, "x": 0.0, "hp": 1.0}]);
        assert!(matches!(
            Sim::restore(&retagged),
            Err(CheckpointError::Malformed(_))
        ));
        // A payload of another layout is still refused by its tag, whatever it holds.
        let alien = serde_json::json!({"format": "rh-checkpoint/999", "statics": 1, "world": [2]});
        assert!(matches!(
            Sim::restore(&alien),
            Err(CheckpointError::UnsupportedFormat { .. })
        ));
    }

    #[test]
    fn a_missing_format_tag_is_refused_with_a_typed_error() {
        let mut json = serde_json::to_value(sim()).unwrap();
        json.as_object_mut().unwrap().remove("format");
        assert_eq!(
            Sim::restore(&json).err(),
            Some(CheckpointError::MissingFormat)
        );
        // The pre-tag layout (a flat Sim) has no tag either.
        let flat = serde_json::json!({"config": {}, "tick": 3});
        assert_eq!(
            Sim::restore(&flat).err(),
            Some(CheckpointError::MissingFormat)
        );
        let err = serde_json::from_value::<Sim>(flat).unwrap_err().to_string();
        assert!(err.contains("no format tag"), "{err}");
    }

    #[test]
    fn a_tagged_checkpoint_without_its_parts_is_malformed() {
        let json = serde_json::json!({"format": CHECKPOINT_FORMAT, "world": {}});
        assert!(matches!(
            Sim::restore(&json),
            Err(CheckpointError::Malformed(_))
        ));
        let mut json = serde_json::to_value(sim()).unwrap();
        json["world"] = serde_json::json!({"tick": "soon"});
        assert!(matches!(
            Sim::restore(&json),
            Err(CheckpointError::Malformed(_))
        ));
    }

    /// Restores `json` and returns why it was refused.
    fn refusal(json: &serde_json::Value) -> String {
        match Sim::restore(json) {
            Err(CheckpointError::Malformed(why)) => why,
            Err(e) => panic!("expected Malformed, got {e}"),
            Ok(_) => panic!("the checkpoint was accepted"),
        }
    }

    fn stepped(n: usize) -> serde_json::Value {
        let mut a = sim();
        for _ in 0..n {
            a.step();
        }
        serde_json::to_value(&a).unwrap()
    }

    #[test]
    fn neutral_affiliation_is_distinct_in_canonical_hash_and_roundtrips_as_null() {
        use crate::fighter::FighterAffiliation;
        // Hash/serde perturbation fixture only: a neutral player remains inadmissible to restore/step.
        let mut candidate = sim();
        let mut hashes = std::collections::BTreeSet::new();
        for affiliation in FactionId::ALL
            .into_iter()
            .map(FighterAffiliation::Faction)
            .chain([FighterAffiliation::Neutral])
        {
            candidate.w.players[0].vitals.faction = affiliation;
            assert!(hashes.insert(candidate.state_hash()));
            assert_eq!(candidate.check_layout(), Ok(()));
            let value = serde_json::to_value(affiliation).unwrap();
            assert_eq!(
                serde_json::from_value::<FighterAffiliation>(value.clone()).unwrap(),
                affiliation
            );
            assert_eq!(value.is_null(), affiliation == FighterAffiliation::Neutral);
        }
        assert_eq!(hashes.len(), 6);
        assert_eq!(FactionId::ALL.len(), 5);
    }

    #[test]
    fn neutral_player_is_refused_before_any_validated_faction_facade() {
        let mut json = stepped(5);
        // Existing real-faction strings remain source-compatible; null is typed neutral.
        assert_eq!(
            json["world"]["players"][0]["core"]["vitals"]["faction"],
            "Holy"
        );
        json["world"]["players"][0]["core"]["vitals"]["faction"] = serde_json::Value::Null;
        assert!(refusal(&json).contains("neutral player affiliation"));
        let good = stepped(5);
        let mut restored = Sim::restore(&good).unwrap();
        restored.step();
    }

    #[test]
    fn a_stale_next_id_is_refused() {
        let mut json = stepped(5);
        json["world"]["next_id"] = 3.into(); // players 1..=3 are seated
        assert!(refusal(&json).contains("next_id"));
        // A leaver stays in the roster: its id is not free either.
        let mut json = stepped(5);
        json["world"]["players"].as_array_mut().unwrap().pop();
        json["world"]["next_id"] = 3.into();
        assert!(refusal(&json).contains("next_id"));
        json["world"]["next_id"] = 4.into();
        assert!(Sim::restore(&json).is_ok());
        // The next join adds one: u32::MAX would overflow it.
        let mut json = stepped(5);
        json["world"]["next_id"] = u32::MAX.into();
        assert!(refusal(&json).contains("next_id"));
        json["world"]["next_id"] = (u32::MAX - 1).into();
        // Numeric headroom alone is insufficient: the typed append-only actor history
        // must account for every allocation, including in player-only worlds.
        assert!(refusal(&json).contains("actor provenance/counter mismatch"));
    }

    #[test]
    fn a_hunt_selection_must_name_a_living_other_player() {
        let mut json = stepped(5);
        json["world"]["players"][0]["hunt_target"] = 1.into();
        assert!(refusal(&json).contains("hunt"));
        let mut json = stepped(5);
        json["world"]["players"][0]["hunt_target"] = 99.into();
        assert!(refusal(&json).contains("hunt"));
        let mut json = stepped(5);
        json["world"]["players"][0]["hunt_stacks"] = 99.into();
        assert!(refusal(&json).contains("hunt"));
        let mut json = stepped(5);
        json["world"]["players"][0]["hunt_target"] = 2.into();
        assert!(Sim::restore(&json).is_ok());
    }

    #[test]
    fn a_roster_out_of_order_is_refused() {
        let mut json = stepped(5);
        json["world"]["roster"]["names"]
            .as_array_mut()
            .unwrap()
            .swap(0, 1);
        assert!(refusal(&json).contains("ascending"));
        let mut json = stepped(5);
        let names = json["world"]["roster"]["names"].as_array_mut().unwrap();
        names[1] = names[0].clone();
        assert!(refusal(&json).contains("ascending"));
    }

    #[test]
    fn a_non_finite_clock_is_refused() {
        // JSON cannot carry NaN or infinity, but another serde format can: check the decoded state itself.
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let mut a = sim();
            a.w.server_time = bad;
            assert!(super::check_world(&a.k, &a.w).is_err(), "{bad}");
        }
        let mut a = sim();
        assert!(super::check_world(&a.k, &a.w).is_ok());
        // Finite but beyond where tick arithmetic is exact (the rewind ring would never trim and would fill), or negative.
        for bad in [1e300, -1.0, u32::MAX as f64 * TICK_MS * 2.0] {
            a.w.server_time = bad;
            assert!(super::check_world(&a.k, &a.w).is_err(), "{bad}");
        }
        a.w.server_time = u32::MAX as f64 * TICK_MS;
        assert!(super::check_world(&a.k, &a.w).is_ok());
    }

    #[test]
    fn pending_wish_times_require_finite_nonnegative_past_clock_for_all_variants() {
        use crate::{
            status_runtime::{AbilityId, CastEndReason},
            Event, PlayerId,
        };
        // Declared numeric-domain controls exercise the checker directly because JSON cannot carry NaN/infinity.
        let base = sim();
        let now = base.server_time();
        for kind in 0..3 {
            for (time, accepted) in [
                (0., true),
                (now, true),
                (f64::NAN, false),
                (f64::INFINITY, false),
                (f64::NEG_INFINITY, false),
                (-1., false),
                (now + 1., false),
            ] {
                let mut a = base.clone();
                let event = match kind {
                    0 => Event::CastStarted {
                        event_time: time,
                        id: PlayerId(1),
                        ability: AbilityId::Freeze,
                        ms: 250.,
                        target: None,
                        x: 300.,
                        y: 300.,
                    },
                    1 => Event::CastLanded {
                        event_time: time,
                        id: PlayerId(1),
                        ability: AbilityId::Freeze,
                        target: None,
                        x: 300.,
                        y: 300.,
                        to: None,
                    },
                    _ => Event::CastEnded {
                        event_time: time,
                        id: PlayerId(1),
                        ability: AbilityId::Freeze,
                        reason: CastEndReason::Cancelled,
                    },
                };
                assert_eq!(a.server_time(), now);
                a.w.pending_events.push(event);
                let result = super::check_world(&a.k, &a.w);
                if accepted {
                    assert!(result.is_ok(), "{kind}/{time}: {result:?}");
                } else {
                    let error = result.unwrap_err();
                    assert!(error.contains("event_time"), "{kind}/{time}: {error}");
                }
            }
        }
    }

    /// ADR0026 review: a pending `Hit` (critical or not) is world state; it keeps the hash layout rules (no skipped field,
    /// so both flags hash the same word count), round-trips a checkpoint and changes the hash with the flag.
    #[test]
    fn a_pending_hit_keeps_the_layout_and_round_trips_with_its_critical_flag() {
        use crate::{Event, PlayerId, WeaponId};
        let mut hashes = Vec::new();
        for critical in [false, true] {
            let mut a = sim();
            a.w.pending_events.push(Event::Hit {
                victim: PlayerId(1),
                by: Some(PlayerId(2)),
                amount: 12.5,
                weapon: Some(WeaponId::Sword),
                passive: false,
                critical,
            });
            a.check_layout()
                .expect("a pending Hit keeps the hash layout");
            let json = serde_json::to_value(&a).unwrap();
            assert_eq!(
                json.to_string().contains("\"critical\":true"),
                critical,
                "the flag is always serialized"
            );
            let b = Sim::restore(json).expect("the checkpoint restores");
            assert_eq!(b.w.pending_events, a.w.pending_events);
            assert_eq!(b.state_hash(), a.state_hash());
            hashes.push(a.state_hash());
        }
        assert_ne!(hashes[0], hashes[1], "the flag is part of the state hash");
    }

    #[test]
    fn a_pending_action_the_slice_cannot_land_is_refused() {
        let action = |kind: &str, weapon: &str| {
            let p = serde_json::json!({"raw": 1.0, "phys": 1.0, "magic": 0.0, "true_": 0.0});
            serde_json::json!({"kind": kind, "weapon": weapon, "started_at": 0.0, "lands_at": 1.0, "a": 0.5, "packet": p})
        };
        for (kind, weapon) in [
            ("Cast", "Fists"),
            ("Draw", "Bow"),
            ("Swing", "Bow"),
            ("Draw", "Fists"),
        ] {
            let mut json = stepped(5);
            json["world"]["players"][0]["core"]["weapon"]["action"] = action(kind, weapon);
            assert!(refusal(&json).contains("pending"), "{kind} {weapon}");
        }
        // A fist swing is the one action the slice has, and steps.
        let mut json = stepped(5);
        json["world"]["players"][0]["core"]["weapon"]["action"] = action("Swing", "Fists");
        let mut restored = Sim::restore(&json).expect("a fist swing restores");
        for _ in 0..5 {
            restored.step();
        }
        // Non-finite numbers cannot be written in JSON, so check the decoded state.
        let mut a = sim();
        let mut act: crate::state::PendingAction =
            serde_json::from_value(action("Swing", "Fists")).unwrap();
        act.lands_at = f64::NAN;
        a.w.players.iter_mut().next().unwrap().weapon.action = Some(act);
        assert!(super::check_world(&a.k, &a.w).is_err());
    }

    #[test]
    fn a_queued_input_validation_would_change_is_refused() {
        let at = |json: &mut serde_json::Value, field: &str, v: serde_json::Value| {
            json["world"]["players"][0]["core"]["inputs"][field] = v;
        };
        let cases: [(&str, serde_json::Value); 8] = [
            (
                "mv",
                serde_json::json!({"Move": {"x": 1e300, "y": -1e300, "seq": null}}),
            ),
            (
                "mv",
                serde_json::json!({"Move": {"x": 1.0e7, "y": 10.0, "seq": 1}}),
            ),
            (
                "mv",
                serde_json::json!({"Move": {"x": -1.0, "y": 10.0, "seq": 1}}),
            ),
            ("aim", 7.5.into()),
            ("aim", 1e300.into()),
            (
                "actions",
                serde_json::json!([{"Attack": {"a": 100.0, "t": null}}]),
            ),
            (
                "actions",
                serde_json::json!([{"Release": {"a": 1e300, "t": 1.0}}]),
            ),
            (
                "actions",
                serde_json::json!([{"Attack": {"a": 0.5, "t": 1e300}}]),
            ),
        ];
        for (field, v) in cases {
            let mut json = stepped(5);
            at(&mut json, field, v.clone());
            // The last case is a finite time validation keeps; every other one it would change.
            if field == "actions" && v[0]["Attack"]["t"] == 1e300 {
                assert!(Sim::restore(&json).is_ok());
            } else {
                assert!(refusal(&json).contains("queued input"), "{field} {v}");
            }
        }
        let mut json = stepped(5);
        at(
            &mut json,
            "mv",
            serde_json::json!({"Move": {"x": 100.0, "y": 100.0, "seq": 1}}),
        );
        at(&mut json, "aim", 1.0.into());
        at(
            &mut json,
            "actions",
            serde_json::json!([{"Attack": {"a": 0.5, "t": 1.0}}]),
        );
        let mut restored = Sim::restore(&json).expect("valid queued inputs restore");
        for _ in 0..5 {
            restored.step();
        }
    }

    #[test]
    fn a_tick_counter_at_its_maximum_is_refused() {
        let mut json = stepped(5);
        json["world"]["tick"] = u32::MAX.into();
        assert!(refusal(&json).contains("tick"));
        json["world"]["tick"] = (u32::MAX - 1).into();
        assert!(Sim::restore(&json).is_ok());
    }

    #[test]
    fn a_rewind_history_out_of_time_order_is_refused() {
        let mut json = stepped(5);
        json["world"]["players"][0]["core"]["body"]["history"]
            .as_array_mut()
            .unwrap()
            .swap(0, 1);
        assert!(refusal(&json).contains("time order"));
    }

    #[test]
    fn a_rewind_history_dated_after_the_clock_is_refused() {
        let mut json = stepped(5);
        let h = json["world"]["players"][1]["core"]["body"]["history"]
            .as_array_mut()
            .unwrap();
        let last = h.len() - 1;
        h[last]["t"] = 1e12.into();
        assert!(refusal(&json).contains("server_time"));
        // And a whole history in the far future (the ring would fill and panic) is refused the same way.
        let mut json = stepped(5);
        for s in json["world"]["players"][0]["core"]["body"]["history"]
            .as_array_mut()
            .unwrap()
        {
            s["t"] = (1e12 + s["t"].as_f64().unwrap()).into();
        }
        assert!(refusal(&json).contains("server_time"));
    }

    #[test]
    fn a_future_dated_regeneration_clock_is_refused() {
        let mut json = stepped(5);
        let now = json["world"]["server_time"].as_f64().unwrap();
        json["world"]["players"][0]["regen_at"] = now.into();
        assert!(Sim::restore(&json).is_ok());
        json["world"]["players"][0]["regen_at"] = (now + 50.0).into();
        assert!(refusal(&json).contains("regeneration clock"));
        json["world"]["players"][0]["regen_at"] = (-1.0).into();
        assert!(refusal(&json).contains("regeneration clock"));
    }

    /// Steps a restored sim and exercises the doors a caller has: submit, leave, join.
    fn poke(sim: &mut Sim) {
        use crate::input::{validate, RawCommand};
        for _ in 0..6 {
            for id in sim.players().iter().map(|p| p.id).collect::<Vec<_>>() {
                for raw in [
                    RawCommand::Move {
                        x: 300.0,
                        y: 300.0,
                        seq: Some(1),
                    },
                    RawCommand::Attack { a: 0.5, t: None },
                ] {
                    let _ = sim.submit(id, validate(raw).unwrap());
                }
            }
            sim.step();
        }
        if let Some(id) = sim.players().first().map(|p| p.id) {
            sim.remove_player(id);
        }
        let _ = sim.add_player("late", None, false);
        sim.step();
    }

    #[test]
    fn a_too_dense_rewind_history_is_refused() {
        // Samples all at the clock, or a millisecond apart, would fill the 9-slot ring within three steps.
        for gaps in [0.0, 1.0, 49.0] {
            let mut json = stepped(5);
            let now = json["world"]["server_time"].as_f64().unwrap();
            let h: Vec<_> = (0..9)
                .map(|i| {
                    serde_json::json!({"t": now - gaps * (8 - i) as f64, "x": 200.0, "y": 200.0})
                })
                .collect();
            json["world"]["players"][0]["core"]["body"]["history"] = h.into();
            assert!(refusal(&json).contains("tick apart"), "gap {gaps}");
        }
        // A tick apart is what real histories hold (the minimum over real checkpoints is exactly one tick).
        let json = stepped(5);
        let mut s = Sim::restore(&json).unwrap();
        poke(&mut s);
    }

    #[test]
    fn coordinates_outside_the_arena_are_refused() {
        let body = |x: f64, y: f64| {
            let mut json = stepped(5);
            json["world"]["players"][0]["core"]["body"]["x"] = x.into();
            json["world"]["players"][0]["core"]["body"]["y"] = y.into();
            json
        };
        // Opposite extremes cancel in a finiteness sum; 1e25 overflows tile arithmetic; both panicked on the next Move.
        for (x, y) in [
            (1e300, -1e300),
            (1e25, 1e25),
            (-1e15, 0.0),
            (0.0, 1e9),
            (-5000.0, 10.0),
        ] {
            assert!(
                refusal(&body(x, y)).contains("outside the arena"),
                "{x} {y}"
            );
        }
        // A body on the map edge is fine.
        let mut s = Sim::restore(body(5.0, 5.0)).unwrap();
        poke(&mut s);
        // So are history samples, path points and spawns.
        let mut json = stepped(5);
        json["world"]["players"][0]["core"]["body"]["history"][0]["x"] = 1e300.into();
        assert!(refusal(&json).contains("rewind sample"));
        let mut json = stepped(5);
        json["world"]["players"][0]["core"]["motion"]["path"] =
            serde_json::json!([0,[{"x": 1e300, "y": -1e300}]]);
        assert!(refusal(&json).contains("path point"));
        let mut json = stepped(5);
        json["statics"]["arena"]["spawns"] = serde_json::json!([{"x": 1e300, "y": -1e300}]);
        assert!(refusal(&json).contains("spawn"));
    }

    #[test]
    fn a_lobby_with_a_wild_spawn_is_refused() {
        let mut a = Sim::new(
            SimConfig::default(),
            practice_arena(),
            Secrets::from_seed(1),
        );
        a.add_player("a", None, false);
        let mut json = serde_json::to_value(&a).unwrap();
        json["statics"]["arena"]["spawns"] = serde_json::json!([{"x": 1e300, "y": -1e300}]);
        assert!(refusal(&json).contains("spawn"));
    }

    #[test]
    fn counters_past_what_a_match_can_have_produced_are_refused() {
        let cases: [(&[&str], serde_json::Value, &str); 6] = [
            (&["players", "0", "credit", "bot_kills"], 5.into(), "kills"),
            (&["players", "0", "credit", "kills"], 99.into(), "kills"),
            (
                &["players", "0", "credit", "kills"],
                u32::MAX.into(),
                "kills",
            ),
            (&["joined"], 99.into(), "joined"),
            (
                &["rt", "downs_between_ticks"],
                99.into(),
                "downs_between_ticks",
            ),
            (
                &["rt", "downs_between_ticks"],
                u32::MAX.into(),
                "downs_between_ticks",
            ),
        ];
        for (path, v, needle) in cases {
            let mut json = stepped(5);
            let mut at = &mut json["world"];
            for k in path {
                at = match k.parse::<usize>() {
                    Ok(i) => &mut at[i],
                    Err(_) => &mut at[*k],
                };
            }
            *at = v.clone();
            assert!(refusal(&json).contains(needle), "{path:?} {v}");
        }
        // bot_kills > kills panicked at the next resolve (debug overflow; release persisted 4294967295).
        let mut json = stepped(5);
        json["world"]["players"][0]["credit"]["bot_kills"] = 1.into();
        assert!(refusal(&json).contains("kills"));
        // Inside the natural bounds it restores and plays on.
        let mut json = stepped(5);
        json["world"]["players"][0]["credit"]["kills"] = 2.into();
        json["world"]["players"][0]["credit"]["bot_kills"] = 1.into();
        json["world"]["rt"]["downs_between_ticks"] = 1.into();
        let mut s = Sim::restore(&json).unwrap();
        poke(&mut s);
    }

    #[test]
    fn counters_that_cannot_be_bounded_saturate() {
        // `dropped` counts rejected orders with no natural bound: at its maximum it stays there (debug used to overflow).
        let mut json = stepped(5);
        json["world"]["players"][0]["core"]["inputs"]["dropped"] = u32::MAX.into();
        let mut s = Sim::restore(&json).unwrap();
        poke(&mut s);
        let mut json = stepped(5);
        json["world"]["players"][0]["credit"]["gv_parts"]["bounty"] = u32::MAX.into();
        json["world"]["players"][0]["credit"]["gv_parts"]["kills"] = u32::MAX.into();
        let mut s = Sim::restore(&json).unwrap();
        poke(&mut s);
    }

    #[test]
    fn carried_weapons_restore_but_fists_are_not_an_item() {
        for item in ["Bow", "Wand", "Sword"] {
            let mut json = stepped(5);
            json["world"]["players"][2]["core"]["weapon"]["weapon1"] = item.into();
            assert!(Sim::restore(&json).is_ok(), "{item}");
        }
        let mut json = stepped(5);
        json["world"]["players"][2]["core"]["weapon"]["weapon0"] = "Fists".into();
        assert!(refusal(&json).contains("invalid carried"));
    }

    /// Every node of a JSON document, as a path of keys and indices.
    fn paths(v: &serde_json::Value, at: &mut Vec<String>, out: &mut Vec<Vec<String>>) {
        out.push(at.clone());
        match v {
            serde_json::Value::Array(a) => {
                for (i, x) in a.iter().enumerate() {
                    at.push(i.to_string());
                    paths(x, at, out);
                    at.pop();
                }
            }
            serde_json::Value::Object(o) => {
                for (k, x) in o {
                    at.push(k.clone());
                    paths(x, at, out);
                    at.pop();
                }
            }
            _ => {}
        }
    }

    fn node<'a>(v: &'a mut serde_json::Value, at: &[String]) -> &'a mut serde_json::Value {
        let mut cur = v;
        for k in at {
            cur = match cur {
                serde_json::Value::Array(a) => &mut a[k.parse::<usize>().unwrap()],
                serde_json::Value::Object(o) => o.get_mut(k).unwrap(),
                _ => unreachable!(),
            };
        }
        cur
    }

    /// Whatever a damaged checkpoint holds, restoring it either fails with an error or yields a match that steps: the
    /// tick's own asserts are never the first to notice.
    #[test]
    fn mutated_checkpoints_never_panic_on_restore_or_the_steps_after() {
        use crate::rng::Mulberry32;
        let base = stepped(40);
        // `base` is stepped to a quiet moment: give players queued inputs and an action in flight to mutate.
        let mut base = base;
        base["world"]["players"][0]["core"]["inputs"]["mv"] =
            serde_json::json!({"Move": {"x": 100.0, "y": 100.0, "seq": 1}});
        base["world"]["players"][0]["core"]["inputs"]["aim"] = 1.0.into();
        base["world"]["players"][0]["core"]["inputs"]["actions"] =
            serde_json::json!([{"Attack": {"a": 0.5, "t": 1.0}}]);
        base["world"]["players"][1]["core"]["weapon"]["action"] = serde_json::json!({"kind": "Swing", "weapon": "Fists",
            "started_at": 0.0, "lands_at": 1.0, "a": 0.5, "packet": {"raw": 1.0, "phys": 1.0, "magic": 0.0, "true_": 0.0}});
        let mut all = Vec::new();
        paths(&base["world"], &mut vec!["world".into()], &mut all);
        // Aim the mutations at the places the rules guard as often as at any other node.
        let guarded: Vec<_> = all
            .iter()
            .filter(|p| {
                let l = p.last().map(String::as_str);
                matches!(
                    l,
                    Some(
                        "server_time"
                            | "next_id"
                            | "tick"
                            | "inputs"
                            | "action"
                            | "mv"
                            | "aim"
                            | "actions"
                            | "history"
                            | "x"
                            | "y"
                            | "kills"
                            | "bot_kills"
                            | "joined"
                            | "dropped"
                            | "downs_between_ticks"
                            | "path"
                            | "bounty"
                    )
                )
            })
            .cloned()
            .collect();
        all.extend(guarded.iter().cycle().take(all.len()).cloned());
        let pick: [serde_json::Value; 22] = [
            serde_json::json!({"Move": {"x": 1e300, "y": -1e300, "seq": null}}),
            serde_json::json!({"Attack": {"a": 1e300, "t": null}}),
            serde_json::json!([{"Release": {"a": 9.0, "t": 1e300}}]),
            serde_json::json!({"kind": "Cast", "weapon": "Fists", "started_at": 0.0, "lands_at": 0.0, "a": 0.0,
                "packet": {"raw": 1.0, "phys": 1.0, "magic": 0.0, "true_": 0.0}}),
            serde_json::json!({"kind": "Draw", "weapon": "Bow", "started_at": 0.0, "lands_at": 0.0, "a": 0.0,
                "packet": {"raw": 1.0, "phys": 1.0, "magic": 0.0, "true_": 0.0}}),
            serde_json::json!({"t": 1e12, "x": 1.0, "y": 1.0}),
            // Dense histories, huge or cancelling coordinates, counters at their extremes.
            serde_json::json!((0..9)
                .map(|_| serde_json::json!({"t": 2000.0, "x": 1.0, "y": 1.0}))
                .collect::<Vec<_>>()),
            serde_json::json!((0..9)
                .map(|i| serde_json::json!({"t": 1960.0 + i as f64, "x": 1.0, "y": 1.0}))
                .collect::<Vec<_>>()),
            serde_json::json!([{"x": 1e300, "y": -1e300}]),
            serde_json::json!({"x": 1e300, "y": -1e300}),
            (-1e300_f64).into(),
            4294967294u32.into(),
            0.into(),
            1.into(),
            (-1).into(),
            3.into(),
            1e12.into(),
            1e300.into(),
            u32::MAX.into(),
            serde_json::Value::Null,
            "Bow".into(),
            true.into(),
        ];
        let mut rng = Mulberry32::new(0xC0FFEE);
        let (mut refused, mut stepped_ok) = (0, 0);
        for _ in 0..800 {
            let mut json = base.clone();
            for _ in 0..1 + rng.next_u32() % 3 {
                let at = &all[rng.next_u32() as usize % all.len()];
                // The path may point into a node an earlier mutation replaced; skip what no longer resolves.
                let ok = at.iter().try_fold(&json, |cur, k| match cur {
                    serde_json::Value::Array(a) => a.get(k.parse::<usize>().ok()?),
                    serde_json::Value::Object(o) => o.get(k),
                    _ => None,
                });
                if ok.is_none() {
                    continue;
                }
                let target = node(&mut json, at);
                match rng.next_u32() % 4 {
                    0 if target.is_array() => {
                        let a = target.as_array_mut().unwrap();
                        if a.len() >= 2 {
                            let n = a.len();
                            a.swap(0, n - 1);
                        }
                    }
                    1 if target.is_array() => {
                        target.as_array_mut().unwrap().pop();
                    }
                    _ => *target = pick[rng.next_u32() as usize % pick.len()].clone(),
                }
            }
            match Sim::restore(&json) {
                Err(_) => refused += 1,
                Ok(mut sim) => {
                    for _ in 0..20 {
                        sim.step();
                    }
                    poke(&mut sim);
                    stepped_ok += 1;
                }
            }
        }
        assert!(refused > 50 && stepped_ok > 5, "{refused} {stepped_ok}");
    }
}

#[cfg(test)]
#[path = "checkpoint/walk_hint_state_tests.rs"]
mod walk_hint_state_tests;
