//! A source quest giver is a real neutral standing actor. It has no combat controller or faction sheet.
//! Offer linkage is live state; birth provenance survives retirement without retaining a dead body/cache.
use crate::{
    mob_runtime::{ActorOrigin, ActorProvenance, Mob, MobKind},
    state::{PlayerId, World},
    statics::MatchStatic,
};

pub(super) fn birth(k: &MatchStatic, w: &mut World, oi: usize) {
    let offer = &w.quests.as_ref().expect("quest runtime").offers[oi];
    if offer.giver.is_some() {
        return;
    }
    let (quest_id, def, at) = (offer.id, offer.def, offer.at);
    let centre = k
        .arena
        .map
        .layers()
        .expect("quests need source map")
        .data()
        .coliseum
        .centre;
    // Source placePublishedQuest allocates the giver before any token/parcel container.
    let birth_serial = w.next_entity_id();
    let id = PlayerId(w.next_id);
    w.next_id = w.next_id.checked_add(1).expect("actor identity exhausted");
    let provenance = ActorProvenance {
        id,
        origin: ActorOrigin::QuestGiver {
            birth_serial,
            born_tick: w.tick,
            quest_id,
            def,
        },
    };
    let mob = Mob::born(
        &provenance,
        at,
        crate::math::atan2(centre.y - at.y, centre.x - at.x),
        w.server_time,
        k.config.hitboxes,
    );
    w.actor_history.push(provenance);
    w.mobs.push(mob);
    w.quests.as_mut().expect("quest runtime").offers[oi].giver = Some(id);
    crate::systems::frost::prepare(k, w).expect("validated Frost source budget");
}

pub(super) fn retire(w: &mut World, oi: usize) {
    let id = w.quests.as_mut().and_then(|q| q.offers[oi].giver.take());
    if let Some(id) = id {
        w.mobs.remove(id);
    }
}

pub(crate) fn is_giver(w: &World, id: PlayerId) -> bool {
    w.mobs
        .get(id)
        .is_some_and(|m| m.kind == MobKind::QuestGiver)
}

/// Reconstruct only immutable source birth data during restore. This never runs in the tick or advances world RNG.
fn placements(k: &MatchStatic) -> (Vec<super::placement::Placement>, crate::private_rng::Sfc32) {
    let mut stream =
        crate::private_rng::Sfc32::from_words(super::live::quest_salt(k.secrets.reward_salt));
    let mut random = || stream.next_f64();
    let roster = super::roster::select_quests(&mut random);
    let placements = super::placement::place_quests(&k.arena.map, &roster, &mut random);
    (placements, stream)
}

/// Planning allocates offer IDs before the initial camps, including offers later swept from live state.
pub(crate) fn initial_camp_serial_base(k: &MatchStatic, w: &World) -> u64 {
    let before_camps = w.quests.is_some()
        && k.config
            .lifecycle
            .rules()
            .is_some_and(|r| r.plan_seconds > 0.);
    u64::from(w.initial_birth_serial)
        + if before_camps {
            placements(k).0.len() as u64
        } else {
            0
        }
}

pub(crate) fn validate(k: &MatchStatic, w: &World) -> Result<(), String> {
    use crate::{constants::*, fighter::FighterAffiliation};
    let origins: Vec<_> = w
        .actor_history
        .iter()
        .filter(|a| matches!(a.origin, ActorOrigin::QuestGiver { .. }))
        .collect();
    let profile = k.config.quests
        && !k.config.training
        && k.arena
            .map
            .layers()
            .is_some_and(|l| !l.data().camps.is_empty());
    let Some(q) = &w.quests else {
        if (profile && (w.raid_started_at > 0. || w.phase == crate::Phase::Planning))
            || !origins.is_empty()
            || w.mobs.iter().any(|m| m.kind == MobKind::QuestGiver)
        {
            return Err("quest giver without quest runtime".into());
        }
        return Ok(());
    };
    if !profile {
        return Err("quest giver runtime outside quest profile".into());
    }
    let (placements, stream) = placements(k);
    if q.stream != stream || q.offers.len() > placements.len() || origins.len() > placements.len() {
        return Err("quest birth plan/stream mismatch".into());
    }
    let camp_count = if k.config.mob_mode == crate::mob_runtime::MobMode::Off {
        0
    } else {
        k.arena.map.layers().map_or(0, |l| {
            l.data().camps.iter().map(|c| c.spots.len() as u32).sum()
        })
    };
    let planned = k
        .config
        .lifecycle
        .rules()
        .is_some_and(|r| r.plan_seconds > 0.);
    // offerQuest publishes immediately only without planning, so known giver/container births
    // interleave offer IDs in that profile. Planning allocates every offer first, then the camps.
    let mut next =
        u64::from(w.initial_birth_serial) + if planned { 0 } else { u64::from(camp_count) };
    let mut quest_ids = Vec::with_capacity(placements.len());
    let mut giver_ids = vec![None; placements.len()];
    let resources = |p: &super::placement::Placement| match super::catalog::DEFINITION[p.def].kind {
        super::catalog::Kind::Collect => p.tokens.len() as u64,
        super::catalog::Kind::Fetch => u64::from(p.parcel.is_some()),
        super::catalog::Kind::Kill => 0,
    };
    for (i, p) in placements.iter().enumerate() {
        next += 1;
        quest_ids.push(next);
        if !planned && p.known {
            next += 1;
            giver_ids[i] = Some(next);
            next += resources(p);
        }
    }
    if planned {
        next += u64::from(camp_count);
        for (i, p) in placements.iter().enumerate().filter(|(_, p)| p.known) {
            next += 1;
            giver_ids[i] = Some(next);
            next += resources(p);
        }
    }
    if next > u64::from(u32::MAX) || (w.raid_started_at > 0. && next > u64::from(w.entity_counter))
    {
        return Err("quest allocation prefix exceeds counter".into());
    }
    let centre = k
        .arena
        .map
        .layers()
        .expect("checked map")
        .data()
        .coliseum
        .centre;
    let index = |id: u32| {
        quest_ids
            .iter()
            .position(|expected| *expected == u64::from(id))
    };
    for o in &q.offers {
        let p = index(o.id)
            .and_then(|i| placements.get(i))
            .ok_or("quest lacks immutable birth placement")?;
        if o.def as usize != p.def
            || o.known != p.known
            || o.at != p.at
            || o.tokens != p.tokens
            || o.parcel != p.parcel
        {
            return Err("quest immutable placement mismatch".into());
        }
        if !o.published
            && (o.status != super::live::Status::Open
                || o.expires_at != 0.
                || !o.accepted.is_empty()
                || !o.progress.is_empty()
                || !o.visits.is_empty()
                || o.carrier.is_some()
                || o.last_carrier.is_some()
                || o.done_by.is_some()
                || o.closed_at != 0.
                || !o.containers.is_empty())
        {
            return Err("unpublished quest cannot have accepted/closed runtime".into());
        }
        let should_stand =
            w.phase == crate::Phase::Active && o.published && o.status == super::live::Status::Open;
        if should_stand != o.giver.is_some() {
            return Err("quest giver lifecycle mismatch".into());
        }
        if let Some(id) = o.giver {
            if !is_giver(w, id)
                || !matches!(w.actor_origin(id), Some(ActorOrigin::QuestGiver { quest_id, def, .. }) if *quest_id == o.id && *def == o.def)
            {
                return Err("quest giver link does not resolve".into());
            }
        }
    }
    let mut quests = std::collections::BTreeSet::new();
    let mut serials = std::collections::BTreeSet::new();
    for row in &w.actor_history {
        if let Some(serial) = row.origin.birth_serial() {
            if !serials.insert(serial) {
                return Err("duplicate actor birth serial".into());
            }
        }
    }
    for row in origins {
        let ActorOrigin::QuestGiver {
            birth_serial,
            born_tick,
            quest_id,
            def,
        } = row.origin
        else {
            unreachable!()
        };
        let pi = index(quest_id).ok_or("giver names an unallocated quest")?;
        let p = &placements[pi];
        // Counter ticks have no clock epoch. Reconstruct elapsed time relative to the current
        // finite source clock; use the same magnitude-aware allowance as the NPC clock checks.
        let clock_epsilon = TIE_EPS_MS.max(8. * f64::EPSILON * w.server_time.max(1.));
        let born = w.server_time - f64::from(w.tick.saturating_sub(born_tick)) * TICK_MS;
        if def as usize != p.def
            || !quests.insert(quest_id)
            || w.roster.name(row.id).is_some()
            || u64::from(birth_serial) <= u64::from(w.initial_birth_serial)
            || birth_serial > w.entity_counter
            || born_tick == 0
            || born_tick > w.tick
            || w.raid_started_at <= 0.
            || born + clock_epsilon < w.raid_started_at
            || w.containers.iter().any(|c| c.id == birth_serial)
            || w.reward_chests.iter().any(|c| c.id == birth_serial)
            || w.projectiles.iter().any(|c| c.launch.id == birth_serial)
            || w.abilities
                .as_ref()
                .is_some_and(|a| a.fields.iter().any(|f| f.id == birth_serial))
        {
            return Err("invalid quest giver birth provenance".into());
        }
        if p.known {
            if (born - w.raid_started_at).abs() > clock_epsilon
                || Some(u64::from(birth_serial)) != giver_ids[pi]
            {
                return Err("known giver birth order mismatch".into());
            }
        } else if born + clock_epsilon < w.raid_started_at + QUEST_REVEAL_HEAD_START_MS
            || u64::from(birth_serial) <= next
        {
            return Err("hidden giver born before source reveal head start/prefix".into());
        }
        if !p.known
            && q.offers.iter().find(|o| o.id == quest_id).is_some_and(|o| {
                !o.published
                    || o.finder.is_none()
                    || !o.publish_at.is_finite()
                    || o.publish_at < w.raid_started_at + QUEST_REVEAL_HEAD_START_MS - clock_epsilon
                    || born + clock_epsilon < o.publish_at
                    || born >= o.publish_at + TICK_MS + clock_epsilon
            })
        {
            return Err("hidden giver lacks its retained discovery/publication clock".into());
        }
        let Some(m) = w.mobs.get(row.id) else {
            continue;
        };
        let Some(o) = q
            .offers
            .iter()
            .find(|o| o.id == quest_id && o.giver == Some(row.id))
        else {
            return Err("orphan live quest giver".into());
        };
        let facing = crate::math::atan2(centre.y - p.at.y, centre.x - p.at.x);
        let expected = Mob::born(row, p.at, facing, born, k.config.hitboxes);
        let c = &m.core;
        let h = c.body.history.as_slice();
        let count = ((w.tick - born_tick) as usize + 1)
            .min(((MAX_REWIND_MS + TICK_MS) / TICK_MS) as usize + 1);
        // The source trim compares actual f64 timestamps against now - window. At a
        // binade/rounding boundary it may trim the boundary sample one step earlier.
        let len_ok = h.len() == count
            || (count == ((MAX_REWIND_MS + TICK_MS) / TICK_MS) as usize + 1
                && h.len() + 1 == count
                && h.first().is_some_and(|s| {
                    ((s.t - TICK_MS) - (w.server_time - MAX_REWIND_MS - TICK_MS)).abs()
                        <= clock_epsilon
                }));
        if m.kind != MobKind::QuestGiver
            || o.status != super::live::Status::Open
            || !o.published
            || m.brain.is_some()
            || m.last_hit_at != 0.
            || m.mob_type.is_some()
            || m.elite
            || m.camp != 0
            || m.owner.is_some()
            || m.zombie.is_some()
            || m.display_name.is_some()
            || m.repath_phase != 0
            || m.home != p.at
            || m.home_facing != facing
            || m.status != crate::Status::Alive
            || c.vitals.faction != FighterAffiliation::Neutral
            || c.vitals != expected.core.vitals
            || c.body.x != p.at.x
            || c.body.y != p.at.y
            || c.body.facing != facing
            || c.weapon != expected.core.weapon
            || c.signature != expected.core.signature
            || c.statuses != expected.core.statuses
            || c.modifiers != expected.core.modifiers
            || c.card_dot_crit.is_some()
            || c.motion != expected.core.motion
            || c.inputs != expected.core.inputs
            || !len_ok
            || h.last().is_none_or(|s| s.t != w.server_time)
            || h.iter().enumerate().any(|(i, s)| {
                s.x != p.at.x
                    || s.y != p.at.y
                    || (s.t - (w.server_time - (h.len() - i - 1) as f64 * TICK_MS)).abs()
                        > clock_epsilon
            })
        {
            return Err("invalid neutral quest giver body/runtime".into());
        }
    }
    let giver_origin = |id| matches!(w.actor_origin(id), Some(ActorOrigin::QuestGiver { .. }));
    if w.projectiles
        .iter()
        .any(|p| giver_origin(p.launch.owner) || p.launch.target.is_some_and(giver_origin))
    {
        return Err("quest giver cannot own or attract a projectile".into());
    }
    for core in w
        .players
        .iter()
        .map(|p| &p.core)
        .chain(w.mobs.iter().map(|m| &m.core))
    {
        if core.weapon.targeting.target.is_some_and(giver_origin)
            || core
                .weapon
                .action
                .and_then(|a| a.target)
                .is_some_and(giver_origin)
            || core.signature.target.is_some_and(giver_origin)
            || core.signature.engaged_on.is_some_and(giver_origin)
            || core
                .statuses
                .cast
                .and_then(|c| c.producer)
                .and_then(|p| p.target)
                .is_some_and(giver_origin)
        {
            return Err("quest giver cannot be a committed combat target".into());
        }
    }
    for m in w.mobs.iter().filter(|m| m.kind == MobKind::QuestGiver) {
        if !matches!(
            w.actor_origin(m.core.id),
            Some(ActorOrigin::QuestGiver { .. })
        ) {
            return Err("giver lacks typed provenance".into());
        }
    }
    Ok(())
}
