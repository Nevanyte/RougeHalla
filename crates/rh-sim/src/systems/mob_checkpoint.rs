//! Admission for the PvE actor domain. History is typed, append-only provenance, never an id range.
use crate::{
    constants::*,
    mob_runtime::{ActorOrigin, BrainMode, MobMode},
    state::{ActionKind, Status, World},
    statics::MatchStatic,
    WeaponId,
};
pub(crate) fn validate(
    k: &MatchStatic,
    w: &World,
    near: impl Fn(f64, f64) -> bool,
) -> Result<(), String> {
    if k.config.mob_mode != MobMode::Pve {
        return Err("wrong PvE mode".into());
    }
    if w.practice.is_some() {
        return Err("training practice state in a PvE world".into());
    }
    super::mobs::admit_factions(k, w).map_err(str::to_owned)?;
    let rt = w.mob_runtime.as_ref().ok_or("missing mob runtime")?;
    let map = k.arena.map.layers().ok_or("missing mob layers")?.data();
    if !rt.combat
        || rt.camps.len() != map.camps.len()
        || rt.life.len() != map.camps.len()
        || w.next_id as usize != w.actor_history.len() + 1
    {
        return Err("invalid actor/runtime cardinality".into());
    }
    // Initial storage replays real allocations before mob birth provenance is considered.
    super::initial_loot::validate(k, w)?;
    let mut players = 0;
    let mut serial = w.initial_birth_serial;
    let initial_serial_base = crate::quests::giver::initial_camp_serial_base(k, w);
    let mut births = 0;
    let initial_count: usize = map.camps.iter().map(|c| c.spots.len()).sum();
    let initial_order: Vec<_> = map
        .camps
        .iter()
        .enumerate()
        .flat_map(|(ci, c)| {
            c.spots
                .iter()
                .enumerate()
                .map(move |(si, _)| (ci as u32, si as u32))
        })
        .collect();
    let mut latest = vec![None::<(u32, u32, u32)>; map.camps.len()];
    for (i, row) in w.actor_history.iter().enumerate() {
        if row.id.0 as usize != i + 1 {
            return Err("noncontiguous actor history".into());
        }
        match row.origin {
            ActorOrigin::Player { join_ordinal } => {
                if join_ordinal as usize != players || w.roster.name(row.id).is_none() {
                    return Err("invalid player provenance".into());
                }
                players += 1;
            }
            ActorOrigin::QuestGiver { .. } => {}
            ActorOrigin::Practice { .. } | ActorOrigin::Dummy { .. } => {
                return Err("non-regional actor in a regional world".into());
            }
            ActorOrigin::Zombie { owner } => {
                if w.roster.name(owner).is_none()
                    || w.roster.name(row.id).is_some()
                    || w.mobs
                        .get(row.id)
                        .is_some_and(|m| m.owner != Some(owner) || m.zombie.is_none())
                {
                    return Err("invalid zombie provenance".into());
                }
            }
            ActorOrigin::Mob {
                birth_serial,
                born_tick,
                camp,
                spot,
                mob_type,
                elite,
            } => {
                let c = map.camps.get(camp as usize).ok_or("unknown birth camp")?;
                let published = &rt.camps[camp as usize];
                let expected = if elite {
                    published.elite
                } else {
                    Some(published.mob_type)
                };
                if w.roster.name(row.id).is_some()
                    || birth_serial <= serial
                    || birth_serial > w.entity_counter
                    || born_tick == 0
                    || born_tick > w.tick
                    || spot as usize >= c.spots.len()
                    || elite != (spot as i32 == c.elite_spot)
                    || Some(mob_type) != expected
                    || w.containers.iter().any(|p| p.id == birth_serial)
                    || w.projectiles.iter().any(|p| p.launch.id == birth_serial)
                    || w.reward_chests.iter().any(|p| p.id == birth_serial)
                    || w.abilities
                        .as_ref()
                        .is_some_and(|a| a.fields.iter().any(|f| f.id == birth_serial))
                {
                    return Err("invalid typed mob provenance".into());
                }
                if births < initial_count
                    && (initial_order[births] != (camp, spot)
                        || u64::from(birth_serial) != initial_serial_base + births as u64 + 1
                        || f64::from(born_tick) * TICK_MS != w.raid_started_at)
                {
                    return Err("invalid initial birth order".into());
                }
                match latest[camp as usize] {
                    None => {
                        if spot != 0 {
                            return Err("birth cycle did not start at zero".into());
                        }
                    }
                    Some((last_tick, last_spot, last_serial)) => {
                        if born_tick == last_tick {
                            if spot != last_spot + 1 || birth_serial != last_serial + 1 {
                                return Err("noncontiguous birth cycle".into());
                            }
                        } else if spot != 0
                            || last_spot as usize + 1 != c.spots.len()
                            || f64::from(born_tick.saturating_sub(last_tick)) * TICK_MS
                                < CAMP_RESPAWN_MS
                        {
                            return Err("invalid respawn cycle".into());
                        }
                    }
                }
                latest[camp as usize] = Some((born_tick, spot, birth_serial));
                serial = birth_serial;
                births += 1;
            }
        }
    }
    if players != w.roster.len()
        || w.players
            .iter()
            .any(|p| !matches!(w.actor_origin(p.id), Some(ActorOrigin::Player { .. })))
        || (w.raid_started_at == 0. && births != 0)
        || (w.raid_started_at > 0. && births < initial_count)
    {
        return Err("incomplete actor provenance".into());
    }
    for (ci, (c, d)) in rt.camps.iter().zip(&map.camps).enumerate() {
        let zone = crate::FactionId::parse(d.zone.as_str()).unwrap();
        if crate::mob_catalog::mob_type_in(zone, Some(c.mob_type.as_str())).is_none_or(|t| t.elite)
            || c.elite.is_some() != (d.elite_spot >= 0)
            || c.elite.is_some_and(|id| {
                crate::mob_catalog::mob_type_in(zone, Some(id.as_str())).is_none_or(|t| !t.elite)
            })
            || c.state > 2
            || c.alive as usize > d.spots.len()
        {
            return Err("invalid camp roster".into());
        }
        if w.raid_started_at > 0.
            && (c.alive as usize
                != w.mobs
                    .iter()
                    // Owned zombies carry camp 0 but are not a camp member: they must not count against the roster's
                    // alive total (they are validated by the typed Zombie branch above).
                    .filter(|m| {
                        m.camp as usize == ci
                            && m.status == Status::Alive
                            && m.zombie.is_none()
                            && m.kind == crate::mob_runtime::MobKind::Regional
                    })
                    .count()
                || latest[ci].is_none_or(|(_, spot, _)| spot as usize + 1 != d.spots.len()))
        {
            return Err("camp alive/cycle mismatch".into());
        }
        if c.state == 2 {
            if c.alive != 0
                || c.cleared_at <= 0.
                || c.cleared_at > w.server_time
                || c.respawn_at != c.cleared_at + CAMP_RESPAWN_MS
            {
                return Err("invalid camp clear clock".into());
            }
        } else if c.cleared_at != 0. || c.respawn_at != 0. {
            return Err("uncleared camp has timer".into());
        }
        let l = &rt.life[ci];
        if l.contributors
            .iter()
            .enumerate()
            .any(|(i, id)| w.roster.name(*id).is_none() || l.contributors[..i].contains(id))
            || l.ward_owner.is_some_and(|id| w.roster.name(id).is_none())
            || l.ward_expires_at
                != if l.ward_owner.is_some() {
                    c.cleared_at + CAMP_WARD_MS
                } else {
                    0.
                }
        {
            return Err("invalid camp contributor provenance".into());
        }
    }
    for m in &w.mobs {
        if m.kind == crate::mob_runtime::MobKind::QuestGiver {
            continue;
        }
        if m.zombie.is_some() {
            if m.mob_type.is_some()
                || m.kind != crate::mob_runtime::MobKind::Regional
                || m.owner.and_then(|id| w.roster.name(id)).is_none()
                || m.display_name.is_none()
                || !near(m.core.body.x, m.core.body.y)
                || !m.core.vitals.hp.is_finite()
                || !(0. ..=m.core.vitals.max_hp).contains(&m.core.vitals.hp)
            {
                return Err("invalid zombie body".into());
            }
            super::sentenced::validate_actor(k, w, &m.core, None)?;
            // Owned zombies are recipients of the generic Frost loops too; validate their shared signature tuple without
            // adding the regional mob gear/Mark checks this branch deliberately skips.
            super::frost::validate_signature(
                k.config.faction_mode.frost(),
                crate::systems::frost::source_budget(k).map_err(str::to_owned)?,
                w,
                m.core.id,
                &m.core.signature,
            )?;
            if !m.core.signature.ap_hits.valid(w.server_time)
                || m.core
                    .signature
                    .ap_hits
                    .target
                    .is_some_and(|t| !w.known_actor(t))
            {
                return Err("invalid zombie AP provenance".into());
            }
            continue;
        }
        let Some(ActorOrigin::Mob {
            born_tick,
            camp,
            spot,
            mob_type,
            elite,
            birth_serial,
        }) = w.actor_origin(m.core.id)
        else {
            return Err("mob lacks typed provenance".into());
        };
        let d = &map.camps[*camp as usize];
        let at = d.spots[*spot as usize];
        let p = &m.core;
        let expected = crate::mob_runtime::Mob::born(
            w.actor_history.get(p.id).unwrap(),
            crate::Vec2::new(at.x, at.y),
            crate::math::atan2(d.y - at.y, d.x - at.x),
            f64::from(*born_tick) * TICK_MS,
        );
        if m.camp != *camp
            || m.mob_type != Some(*mob_type)
            || m.elite != *elite
            || m.home != expected.home
            || m.home_facing != expected.home_facing
            || m.repath_phase != expected.repath_phase
            || latest[*camp as usize].is_none_or(|(tick, _, _)| tick != *born_tick)
            || *birth_serial == 0
            || !near(p.body.x, p.body.y)
            || !p.body.facing.is_finite()
            || p.motion.path.as_slice().iter().any(|q| !near(q.x, q.y))
            || (k.config.hazards == crate::terrain::Mode::Off && p.motion.slip.is_some())
        {
            return Err("invalid mob identity/body".into());
        }
        if p.vitals.faction != expected.core.vitals.faction
            || p.vitals.max_hp != expected.core.vitals.max_hp
            || !p.vitals.hp.is_finite()
            || !(0. ..=p.vitals.max_hp).contains(&p.vitals.hp)
            || p.vitals.barrier != 0.
            || p.vitals.immune_until != 0.
            || !p.vitals.hp_frac_at_tick_start.is_finite()
            || !(0. ..=1.).contains(&p.vitals.hp_frac_at_tick_start)
            || !matches!(m.status, Status::Alive | Status::Dead)
            || (m.status == Status::Alive) != (p.vitals.hp > 0.)
            || p.card_dot_crit.is_some()
        {
            return Err("invalid mob vitals".into());
        }
        super::signatures::validate_basic(k, w, p.id, &p.signature)?;
        super::sentenced::validate_actor(k, w, p, None)?;
        if p.signature.ap_hits != Default::default() {
            return Err("unsupported mob mark/AP history".into());
        }
        if p.weapon.weapon0 != expected.core.weapon.weapon0
            || p.weapon.weapon1.is_some()
            || p.weapon.slot != 0
            || p.weapon.targeting != Default::default()
            || !p.modifiers.valid(
                &Default::default(),
                &Default::default(),
                &Default::default(),
                &[],
                crate::modifiers::ValidationOwner {
                    base_hp: p.vitals.max_hp,
                    faction: p.faction_id().ok_or("neutral regional actor")?,
                    frozen_guard: false,
                },
            )
        {
            return Err("invalid mob gear/mirrors".into());
        }
        let weapon = &p.weapon;
        if ![
            weapon.aim,
            weapon.aim_at,
            weapon.ready_at,
            weapon.pressed_at,
            weapon.buffered_until,
            weapon.root_until,
            weapon.draw_started_at,
            weapon.lag_ms,
            weapon.stagger_immune_until,
        ]
        .iter()
        .all(|v| v.is_finite())
            || !(0. ..=w.server_time).contains(&weapon.aim_at)
        {
            return Err("invalid mob weapon clocks".into());
        }
        if let Some(a) = weapon.action {
            let pk = a.packet;
            let kind = match a.weapon {
                WeaponId::Bow => ActionKind::Draw,
                WeaponId::Wand => ActionKind::Cast,
                _ => ActionKind::Swing,
            };
            if a.kind != kind
                || a.weapon != p.active_weapon()
                || a.target.is_some()
                || ![
                    a.a,
                    a.started_at,
                    a.lands_at,
                    pk.raw,
                    pk.phys,
                    pk.magic,
                    pk.true_,
                ]
                .iter()
                .all(|v| v.is_finite())
                // The Frost draw correction (source afterWeapons/afterDamage) moves a chilled NPC draw's started_at
                // forward with its lands_at; that is the source-produced chilled Draw form, not a malformed action. Only
                // that narrow form is allowed past the ordinary now bound; every other clock/share rule below stands.
                || (a.started_at > w.server_time
                    && !(a.kind == ActionKind::Draw
                        && p.signature.chill < 1.
                        // weapons starts no later than now + TIE_EPS_MS. afterWeapons interpolates that
                        // start toward now; afterDamage can then add at most (1 - current chill) * dt.
                        // Historical chill/resistance can change, so use this step's cached chill only.
                        // Eight machine epsilons cover the small chain of clock subtraction/addition at
                        // every admitted server-time magnitude; TIE_EPS_MS also covers weapon readiness.
                        && a.started_at
                            <= w.server_time
                                + (1. - p.signature.chill) * TICK_MS
                                + TIE_EPS_MS.max(8. * f64::EPSILON * w.server_time.max(1.))))
                || a.lands_at < a.started_at
                || pk.raw < 0.
                || [pk.phys, pk.magic, pk.true_]
                    .iter()
                    .any(|v| !(0. ..=1.).contains(v))
                || (pk.phys + pk.magic + pk.true_ - 1.).abs() > 4. * f64::EPSILON
            {
                return Err("invalid mob pending attack".into());
            }
        }
        let b = m.brain.as_ref().ok_or("missing regional brain")?;
        if ![m.last_hit_at, b.last_combat_at, b.last_move_at, b.died_at]
            .iter()
            .all(|v| (0. ..=w.server_time).contains(v))
            || b.last_aim.is_some_and(|a| !a.is_finite())
            || b.goal.is_some_and(|p| !near(p.x, p.y))
            || b.target.is_some_and(|id| w.roster.name(id).is_none())
            || b.threat.iter().enumerate().any(|(i, (id, n))| {
                w.roster.name(*id).is_none()
                    || !n.is_finite()
                    || *n < 0.
                    || b.threat[..i].iter().any(|(p, _)| p == id)
            })
            || (b.mode != BrainMode::Fight && b.target.is_some())
            || (m.status == Status::Dead
                && (b.mode != BrainMode::Idle
                    || b.died_at == 0.
                    || weapon.action.is_some()
                    || weapon.held
                    || !p.motion.path.is_empty()))
        {
            return Err("invalid mob brain".into());
        }
        p.inputs.check()?;
        if p.inputs.actions.as_slice().iter().any(|a| {
            !matches!(
                a,
                crate::input::ActionCmd::Attack { .. } | crate::input::ActionCmd::Release { .. }
            )
        }) || matches!(
            p.inputs.mv,
            Some(
                crate::input::MoveCmd::AttackMove { .. }
                    | crate::input::MoveCmd::MoveAt { .. }
                    | crate::input::MoveCmd::AttackMoveAt { .. }
            )
        )
        {
            return Err("unsupported mob input".into());
        }
        if p.statuses.cast.is_some()
            || p.statuses.instances.iter().any(|s| {
                s.kind.rule().players_only
                    || (s.kind == crate::status_runtime::StatusKind::Dot
                        && !(k.config.abilities == crate::abilities::Mode::Full
                            && crate::abilities::checkpoint::blaze_dot(w, s)))
            })
        {
            return Err("unsupported mob status domain".into());
        }
        crate::status_runtime::validate(&p.statuses, w.server_time).map_err(str::to_owned)?;
        if p.statuses.instances.iter().any(|s| {
            [s.source.id, s.source.owner_id]
                .into_iter()
                .flatten()
                .any(|id| !w.known_actor(id))
        }) {
            return Err("unknown mob status source".into());
        }
        let h = p.body.history.as_slice();
        if h.is_empty()
            || h.iter()
                .any(|s| !near(s.x, s.y) || !(0. ..=w.server_time).contains(&s.t))
            || h.windows(2).any(|s| s[1].t - s[0].t < TICK_MS)
        {
            return Err("invalid mob rewind".into());
        }
    }
    Ok(())
}
