//! Source raidStarted regional birth order and shared-input movement foundation.
use crate::{
    hooks::{HookArgs, Hx},
    mob_catalog::rosters,
    mob_runtime::{ActorOrigin, ActorProvenance, CampRoster, Mob, MobMode, MobRuntime},
    state::World,
    statics::MatchStatic,
    FactionId, PlayerId, Vec2,
};

pub(crate) fn basic_faction(f: FactionId) -> bool {
    matches!(f, FactionId::Fire | FactionId::Plague | FactionId::Holy)
}
pub(crate) fn admit_factions(k: &MatchStatic, w: &World) -> Result<(), &'static str> {
    if k.config.faction_mode == crate::FactionMode::Off {
        return Ok(());
    }
    if k.config.mob_mode != MobMode::Pve
        || k.config.faction_mode != crate::FactionMode::EngagementHolyPlagueFire
    {
        return Err("unsupported PvE faction mode");
    }
    if w.players.iter().any(|p| !basic_faction(p.vitals.faction))
        || k.arena.map.layers().is_none_or(|l| {
            l.data()
                .camps
                .iter()
                .any(|c| FactionId::parse(c.zone.as_str()).is_none_or(|f| !basic_faction(f)))
        })
    {
        return Err("unsupported PvE faction content");
    }
    Ok(())
}
pub(crate) fn initialize(k: &mut MatchStatic, w: &mut World) -> Result<(), &'static str> {
    if k.config.training {
        // A training world has no map camps (legacy camps.ts install: "never for training, which has no camps: everything
        // else keeps an empty state.camps") and therefore draws no roster RNG; the shared actor container is still
        // installed so the console's practice mobs and dummies have a runtime (and the dummies' heal system runs).
        w.mob_runtime = Some(MobRuntime {
            combat: true,
            camps: Vec::new(),
            life: Vec::new(),
        });
        w.practice = Some(crate::state::PracticeRuntime {
            spawned: 0,
            last_camp_at: None,
            last_chest_at: None,
            next_camp: crate::constants::PRACTICE_CAMP_FIRST,
        });
        return Ok(());
    }
    if k.config.mob_mode == MobMode::Off {
        return Ok(());
    }
    admit_factions(k, w)?;
    let data = k
        .arena
        .map
        .layers()
        .ok_or("mob foundation needs admitted camp layers")?
        .data();
    // The common initial_loot constructor owns the sole source orderSalt/loot prefix.
    let zones: Vec<_> = data
        .camps
        .iter()
        .map(|c| FactionId::parse(c.zone.as_str()).expect("typed zone"))
        .collect();
    let specs: Vec<_> = data
        .camps
        .iter()
        .zip(&zones)
        .map(|(c, &zone)| rosters::CampSpec {
            zone,
            spot_count: c.spots.len(),
            elite_spot: c.elite_spot,
        })
        .collect();
    let types = rosters::roll_camp_types(&zones, &mut || w.reward_rng.next_f64());
    let elites = rosters::roll_camp_elites(&specs);
    let camps = types
        .into_iter()
        .zip(elites)
        .zip(&specs)
        .map(|((mob_type, elite), s)| CampRoster {
            mob_type,
            elite,
            alive: s.spot_count as u32,
            state: 0,
            cleared_at: 0.,
            respawn_at: 0.,
        })
        .collect();
    w.mob_runtime = Some(MobRuntime {
        life: vec![Default::default(); specs.len()],
        camps,
        combat: k.config.mob_mode == MobMode::Pve,
    });
    Ok(())
}

pub(crate) fn raid_started(hx: &mut Hx, _: &HookArgs) {
    if hx.w.mob_runtime.is_none() || hx.k.config.training {
        // A training world spawns only its practice setup (the `mobs.spawnTraining` link) and no regional camps.
        return;
    }
    let count = hx.k.arena.map.layers().unwrap().data().camps.len();
    for ci in 0..count {
        spawn_camp(hx.k, hx.w, ci);
    }
}
pub(super) fn spawn_camp(k: &MatchStatic, w: &mut World, ci: usize) {
    let camp = &k.arena.map.layers().unwrap().data().camps[ci];
    let published = &w.mob_runtime.as_ref().unwrap().camps[ci];
    let zone = FactionId::parse(camp.zone.as_str()).expect("typed zone");
    let roster = rosters::camp_mobs(
        &rosters::CampSpec {
            zone,
            spot_count: camp.spots.len(),
            elite_spot: camp.elite_spot,
        },
        published.mob_type,
        published.elite,
    );
    for (si, (spot, member)) in camp.spots.iter().zip(roster).enumerate() {
        let serial = w.next_entity_id();
        let id = PlayerId(w.next_id);
        w.next_id = w.next_id.checked_add(1).expect("actor id exhausted");
        let at = Vec2::new(spot.x, spot.y);
        let facing = crate::math::atan2(camp.y - spot.y, camp.x - spot.x);
        let provenance = ActorProvenance {
            id,
            origin: ActorOrigin::Mob {
                birth_serial: serial,
                born_tick: w.tick,
                camp: ci as u32,
                spot: si as u32,
                mob_type: member.mob_type,
                elite: member.elite,
            },
        };
        let mob = Mob::born(&provenance, at, facing, w.server_time);
        w.actor_history.push(provenance);
        w.mobs.push(mob);
    }

    let r = w.mob_runtime.as_mut().unwrap();
    let c = &mut r.camps[ci];
    c.alive = camp.spots.len() as u32;
    c.state = 0;
    c.cleared_at = 0.;
    c.respawn_at = 0.;
    r.life[ci].ward_owner = None;
    r.life[ci].ward_expires_at = 0.;
}

pub(crate) fn role_move(
    w: &World,
    core: &crate::fighter::FighterCore,
    _: f64,
    _: crate::status_runtime::StatView,
) -> f64 {
    w.mobs
        .get(core.id)
        .and_then(|m| m.mob_type)
        .and_then(|ty| crate::mob_catalog::mob_type_by_id(ty.as_str()))
        .map_or(1., |t| t.role_def().move_mult)
}

pub(crate) fn validate(
    k: &MatchStatic,
    w: &World,
    near: impl Fn(f64, f64) -> bool,
) -> Result<(), String> {
    if k.config.training {
        return super::training::validate_actors(k, w, near).map_err(str::to_owned);
    }
    if w.practice.is_some() {
        return Err("training practice state in an arena world".into());
    }
    if k.config.mob_mode == MobMode::Pve {
        return super::mob_checkpoint::validate(k, w, near);
    }
    use crate::mob_runtime::ActorOrigin;
    if u64::from(w.next_id) != w.actor_history.len() as u64 + 1 {
        return Err("actor provenance/counter mismatch".into());
    }
    let mut players = 0usize;
    let mut serial = w.initial_birth_serial;
    let births: Vec<_> = k
        .arena
        .map
        .layers()
        .into_iter()
        .flat_map(|l| l.data().camps.iter())
        .enumerate()
        .flat_map(|(ci, c)| {
            c.spots
                .iter()
                .enumerate()
                .map(move |(si, _)| (ci as u32, si as u32))
        })
        .collect();
    let mut born = 0usize;
    for (i, row) in w.actor_history.iter().enumerate() {
        if row.id.0 as usize != i + 1 {
            return Err("noncontiguous retained actor history".into());
        }
        match row.origin {
            ActorOrigin::Player { join_ordinal } => {
                if join_ordinal as usize != players || w.roster.name(row.id).is_none() {
                    return Err("player actor provenance mismatch".into());
                }
                players += 1;
            }
            ActorOrigin::Practice { .. } | ActorOrigin::Dummy { .. } => {
                return Err("non-regional actor in a regional world".into());
            }
            ActorOrigin::Mob {
                birth_serial,
                born_tick,
                camp,
                spot,
                mob_type,
                elite,
            } => {
                let definition = k
                    .arena
                    .map
                    .layers()
                    .and_then(|l| l.data().camps.get(camp as usize))
                    .ok_or("mob provenance camp missing")?;
                if birth_serial <= serial
                    || birth_serial > w.entity_counter
                    || born_tick > w.tick
                    || born_tick == 0
                    || f64::from(born_tick) * crate::constants::TICK_MS != w.raid_started_at
                    || spot as usize >= definition.spots.len()
                    || elite != (definition.elite_spot == spot as i32)
                    || crate::mob_catalog::mob_type_in(
                        crate::FactionId::parse(definition.zone.as_str()).unwrap(),
                        Some(mob_type.as_str()),
                    )
                    .is_none()
                    || w.roster.name(row.id).is_some()
                    || w.containers.iter().any(|c| c.id == birth_serial)
                    || w.projectiles.iter().any(|p| p.launch.id == birth_serial)
                    || w.abilities
                        .as_ref()
                        .is_some_and(|a| a.fields.iter().any(|f| f.id == birth_serial))
                {
                    return Err("invalid mob birth provenance".into());
                }
                if births.get(born) != Some(&(camp, spot))
                    || birth_serial != w.initial_birth_serial + born as u32 + 1
                {
                    return Err("unsupported regional birth sequence".into());
                }
                let roster = w
                    .mob_runtime
                    .as_ref()
                    .and_then(|r| r.camps.get(camp as usize))
                    .ok_or("birth has no published roster")?;
                let expected = if elite {
                    roster.elite
                } else {
                    Some(roster.mob_type)
                };
                if Some(mob_type) != expected {
                    return Err("birth type differs from published roster".into());
                }
                born += 1;
                serial = birth_serial;
            }
        }
    }
    if players != w.roster.len() {
        return Err("actor history differs from seat roster".into());
    }
    for p in &w.players {
        if !matches!(w.actor_origin(p.id), Some(ActorOrigin::Player { .. })) {
            return Err("present player has no player provenance".into());
        }
    }
    match (&w.mob_runtime, k.config.mob_mode) {
        (None, MobMode::Off) if w.mobs.is_empty() && serial == w.initial_birth_serial => {
            return Ok(())
        }
        (Some(_), MobMode::SpawnFoundation) => {}
        _ => return Err("mob mode/runtime mismatch".into()),
    }
    if (w.raid_started_at == 0. && born != 0) || (w.raid_started_at > 0. && born != births.len()) {
        return Err("incomplete regional birth history".into());
    }
    let is_mob = |id| matches!(w.actor_origin(id), Some(ActorOrigin::Mob { .. }));
    if w.deferred.hits.iter().any(|e| is_mob(e.victim))
        || w.projectiles
            .iter()
            .any(|p| is_mob(p.launch.owner) || p.launch.target.is_some_and(is_mob))
        || w.abilities
            .as_ref()
            .is_some_and(|a| a.dot.iter().any(|d| is_mob(d.victim)))
    {
        return Err("mob combat state requires combat integration".into());
    }
    let rt = w.mob_runtime.as_ref().unwrap();
    let map = k.arena.map.layers().ok_or("mob map absent")?.data();
    if k.config.faction_mode != crate::FactionMode::Off {
        return Err("unsupported foundation faction mode".into());
    }
    let mut initial_main = crate::rng::Mulberry32::new(k.secrets.spawn_seed);
    initial_main.next_u32();
    if k.config.initial_loot {
        crate::initial_world::build_loot(
            &crate::initial_world::Input::from_layers(&k.arena.map, map),
            false,
            &mut initial_main,
            k.secrets.reward_salt,
            &mut InitialReplay::default(),
        )
        .map_err(|_| "initial loot replay")?;
    } else {
        initial_prefix(k, &mut initial_main).map_err(str::to_owned)?;
    }
    if rt.camps.len() != map.camps.len() {
        return Err("camp roster length mismatch".into());
    }
    for (c, d) in rt.camps.iter().zip(&map.camps) {
        let zone = FactionId::parse(d.zone.as_str()).unwrap();
        if c.alive as usize != d.spots.len()
            || crate::mob_catalog::mob_type_in(zone, Some(c.mob_type.as_str()))
                .is_none_or(|t| t.elite)
            || c.elite.is_some() != (d.elite_spot >= 0)
            || c.elite.is_some_and(|id| {
                crate::mob_catalog::mob_type_in(zone, Some(id.as_str())).is_none_or(|t| !t.elite)
            })
        {
            return Err("invalid public camp roster".into());
        }
    }
    for m in &w.mobs {
        let Some(ActorOrigin::Mob {
            birth_serial: _,
            born_tick,
            camp,
            spot,
            mob_type,
            elite,
        }) = w.actor_origin(m.core.id)
        else {
            return Err("mob has no provenance".into());
        };
        let d = &map.camps[*camp as usize];
        let p = d.spots[*spot as usize];
        let facing = crate::math::atan2(d.y - p.y, d.x - p.x);
        let mut expected = Mob::born(
            w.actor_history.get(m.core.id).expect("provenance checked"),
            Vec2::new(p.x, p.y),
            facing,
            f64::from(*born_tick) * crate::constants::TICK_MS,
        );
        let c = &m.core;
        if !c.weapon.aim.is_finite() || !(0. ..=w.server_time).contains(&c.weapon.aim_at) {
            return Err("invalid mob aim".into());
        }
        expected.core.weapon.aim = c.weapon.aim;
        expected.core.weapon.aim_at = c.weapon.aim_at;
        if m.mob_type != Some(*mob_type)
            || m.elite != *elite
            || m.camp != *camp
            || m.home != expected.home
            || m.home_facing != facing
            || m.repath_phase != expected.repath_phase
            || m.status != crate::Status::Alive
            || c.vitals != expected.core.vitals
            || c.weapon != expected.core.weapon
            || c.signature != expected.core.signature
            || c.card_dot_crit.is_some()
            || c.modifiers != crate::modifiers::Runtime::default()
            || c.statuses != expected.core.statuses
            || c.motion.slip.is_some()
            || !near(c.body.x, c.body.y)
            || !c.body.facing.is_finite()
            || c.motion.path.as_slice().iter().any(|p| !near(p.x, p.y))
        {
            return Err("invalid spawn foundation mob state".into());
        }
        c.inputs.check()?;
        if c.inputs.actions.len() != 0
            || c.inputs.move_before != 0
            || c.inputs.aim_before != 0
            || matches!(c.inputs.mv, Some(crate::input::MoveCmd::AttackMove { .. }))
        {
            return Err("unsupported foundation actor action".into());
        }
        crate::status_runtime::validate(&c.statuses, w.server_time).map_err(str::to_owned)?;
        let samples = c.body.history.as_slice();
        if samples.is_empty()
            || samples
                .iter()
                .any(|s| !near(s.x, s.y) || !(0. ..=w.server_time).contains(&s.t))
            || samples
                .windows(2)
                .any(|s| s[1].t - s[0].t < crate::constants::TICK_MS)
        {
            return Err("invalid mob history".into());
        }
    }
    Ok(())
}

/// Adds a practice-console mob (`sim/training.ts` `trainCamp` -> `placeMob`): a regional actor with a camp ref beyond the
/// map's camps (101..255) and a real brain; the training hurt/death path never indexes a map-camp roster for it.
pub(crate) fn place_practice_mob(
    w: &mut World,
    mob_type: crate::mob_catalog::MobTypeId,
    elite: bool,
    camp: u32,
    at: Vec2,
    facing: f64,
) -> PlayerId {
    let serial = w.next_entity_id();
    let id = PlayerId(w.next_id);
    w.next_id = w.next_id.checked_add(1).expect("actor id exhausted");
    let provenance = ActorProvenance {
        id,
        origin: ActorOrigin::Practice {
            birth_serial: serial,
            born_tick: w.tick,
            camp,
            mob_type,
            elite,
        },
    };
    let mob = Mob::born(&provenance, at, facing, w.server_time);
    w.actor_history.push(provenance);
    w.mobs.push(mob);
    id
}

/// Adds a training dummy (`sim/mobs.ts` `addMob` with kind dummy): no faction, no camp, no catalog type, never dies.
/// Used by `mobs.spawnTraining` only.
pub(crate) fn place_dummy(w: &mut World, at: Vec2, facing: f64, shield: bool) -> PlayerId {
    let serial = w.next_entity_id();
    let id = PlayerId(w.next_id);
    w.next_id = w.next_id.checked_add(1).expect("actor id exhausted");
    let provenance = ActorProvenance {
        id,
        origin: ActorOrigin::Dummy {
            birth_serial: serial,
            born_tick: w.tick,
            shield,
        },
    };
    let mob = Mob::born(&provenance, at, facing, w.server_time);
    w.actor_history.push(provenance);
    w.mobs.push(mob);
    id
}

/// Executes real constructor producers into a typed admission sink. Nonempty worlds remain
/// refused until the shared item store can retain and expose every produced object faithfully.
pub(super) fn initial_prefix(
    k: &MatchStatic,
    main: &mut crate::rng::Mulberry32,
) -> Result<(), &'static str> {
    #[derive(Default)]
    struct Sink {
        entity: u32,
        item: u64,
        objects: Vec<crate::initial_world::InitialContainer>,
    }
    impl crate::initial_world::InitialSink for Sink {
        fn next_entity_id(&mut self) -> u32 {
            self.entity += 1;
            self.entity
        }
        fn next_item_uid(&mut self) -> u64 {
            self.item += 1;
            self.item
        }
        fn insert(&mut self, o: crate::initial_world::InitialContainer) {
            self.objects.push(o);
        }
    }
    let mut sink = Sink::default();
    let input = crate::initial_world::Input::from_layers(
        &k.arena.map,
        k.arena
            .map
            .layers()
            .ok_or("mob foundation needs layers")?
            .data(),
    );
    if k.config.mob_mode == MobMode::Pve {
        crate::initial_world::build_loot(&input, false, main, k.secrets.reward_salt, &mut sink)
    } else {
        crate::initial_world::build_initial(&input, false, main, k.secrets.reward_salt, &mut sink)
    }
    .map_err(|_| "invalid initial producer input")?;
    if !sink.objects.is_empty() {
        return Err("nonempty initial-world objects need shared item storage");
    }
    Ok(())
}

type InitialReplay = crate::systems::initial_loot::Replay;
