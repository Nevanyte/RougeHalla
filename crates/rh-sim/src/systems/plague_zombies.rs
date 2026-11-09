//! One owned Plague companion (legacy `plagueZombies.ts`): raise, stats, combat, follow and regen.
use crate::constants::*;
use crate::content::FactionId;
use crate::events::Event;
use crate::geometry::{circle_clear, has_line_of_sight};
use crate::hooks::{HookArgs, Hx, OutCause};
use crate::input::RawCommand;
use crate::map::MASK_MOVE;
use crate::math::{atan2, cos, hypot, sin, Vec2};
use crate::mob_runtime::{ActorOrigin, ActorProvenance, Mob};
use crate::state::{Player, PlayerId, Status, World};
use crate::statics::MatchStatic;
use crate::systems::{weapons, Cx};

pub(crate) fn hostile(w: &World, a: PlayerId, b: PlayerId) -> bool {
    if a == b || crate::quests::giver::is_giver(w, a) || crate::quests::giver::is_giver(w, b) {
        return false;
    }
    let za = w
        .mobs
        .get(a)
        .filter(|m| m.zombie.is_some())
        .and_then(|m| m.owner);
    let zb = w
        .mobs
        .get(b)
        .filter(|m| m.zombie.is_some())
        .and_then(|m| m.owner);
    if za.is_some() || zb.is_some() {
        return za.unwrap_or(a) != zb.unwrap_or(b);
    }
    !(w.mobs.contains(a) && w.mobs.contains(b))
}

pub(crate) fn zombie_of(w: &World, owner: PlayerId) -> Option<PlayerId> {
    w.mobs
        .as_slice()
        .iter()
        .find(|m| m.owner == Some(owner) && m.zombie.is_some())
        .map(|m| m.core.id)
}

/// Source `plagueZombieStats`: the zombie grows mostly from the owner's bonus max hp, plus a little bonus Offense.
pub(crate) fn stats(owner: &Player) -> (f64, f64) {
    let base = crate::content::faction(FactionId::Plague).hp;
    let hp = owner.vitals.max_hp.max(0.);
    let extra = (hp - base).max(0.);
    let growth = 1.
        + f64::from(owner.farm.corpse_stacks().saturating_sub(1)) * PLAGUE_ZOMBIE_GROWTH_PER_BODY;
    let ad = owner.modifiers.mirrors().ad_bonus.max(0.);
    (
        (hp * PLAGUE_ZOMBIE_HP_SHARE + extra * PLAGUE_ZOMBIE_HP_PER_BONUS) * growth,
        ((hp * PLAGUE_ZOMBIE_HIT_SHARE + extra * PLAGUE_ZOMBIE_HIT_PER_BONUS) * growth
            + PLAGUE_ZOMBIE_AD_SHARE * ad)
            .min(hp * PLAGUE_ZOMBIE_HIT_CAP_SHARE * growth),
    )
}

fn beside_owner(k: &MatchStatic, w: &World, owner: &Player) -> Vec2 {
    let map = k.collision_map(w.rt.gates_locked);
    let from = owner.pos();
    for distance in [32., 24., 16.] {
        for turn in [
            std::f64::consts::PI,
            std::f64::consts::FRAC_PI_2,
            -std::f64::consts::FRAC_PI_2,
            0.,
        ] {
            let a = owner.body.facing + turn;
            let at = Vec2::new(from.x + cos(a) * distance, from.y + sin(a) * distance);
            if circle_clear(map, at, PLAYER_RADIUS, MASK_MOVE)
                && has_line_of_sight(map, from, at, MASK_MOVE)
            {
                return at;
            }
        }
    }
    from
}

fn reset_combat(w: &mut World, zid: PlayerId) {
    let now = w.server_time;
    if let Some(m) = w.mobs.get_mut(zid) {
        weapons::cancel_action(&mut m.core, now);
        m.core.weapon.held = false;
        m.core.weapon.buffered_until = 0.;
        m.core.weapon.root_until = 0.;
        m.core.motion.path.clear();
        m.core.inputs = Default::default();
        if let Some(z) = &mut m.zombie {
            z.target = None;
            z.assist_until = 0.;
            z.last_move_at = 0.;
        }
    }
}

fn place(w: &mut World, zid: PlayerId, at: Vec2, facing: f64) {
    if let Some(m) = w.mobs.get_mut(zid) {
        m.core.body.x = at.x;
        m.core.body.y = at.y;
        m.core.body.facing = facing;
        m.core.body.history.reset(crate::state::Sample {
            t: w.server_time,
            x: at.x,
            y: at.y,
        });
        m.core.motion.path.clear();
        m.home = at;
        m.home_facing = facing;
    }
}

fn sync_stats(w: &mut World, owner_id: PlayerId, zid: PlayerId, revive: bool) {
    let Some(owner) = w.player(owner_id) else {
        return;
    };
    let (max_hp, _) = stats(owner);
    if let Some(m) = w.mobs.get_mut(zid) {
        let gained = max_hp - m.core.vitals.max_hp;
        m.core.vitals.max_hp = max_hp;
        m.core.vitals.hp = if revive {
            max_hp
        } else {
            max_hp.min(m.core.vitals.hp + gained.max(0.))
        };
    }
}

/// Called after an authorized corpse is removed and its owner's max-health growth has folded.
pub(crate) fn raise_or_grow(k: &MatchStatic, w: &mut World, owner_id: PlayerId) {
    let Some(owner_ix) = w.idx(owner_id) else {
        return;
    };
    if !w.players[owner_ix].standing() || w.players[owner_ix].vitals.faction != FactionId::Plague {
        return;
    }
    let existing = zombie_of(w, owner_id);
    let (zid, revive) = match existing {
        Some(id) => (
            id,
            !w.mobs.get(id).is_some_and(|m| m.status == Status::Alive),
        ),
        None => {
            let id = PlayerId(w.next_id);
            w.next_id = w.next_id.checked_add(1).expect("actor id exhausted");
            let name = format!("{}'s Zombie", w.roster.name(owner_id).unwrap_or("Plague"));
            let at = beside_owner(k, w, &w.players[owner_ix]);
            let (max_hp, _) = stats(&w.players[owner_ix]);
            let provenance = ActorProvenance {
                id,
                origin: ActorOrigin::Zombie { owner: owner_id },
            };
            let z = Mob::zombie(
                &provenance,
                owner_id,
                at,
                name,
                max_hp,
                w.server_time,
                w.players[owner_ix].motion.displace_seq,
            );
            w.actor_history.push(provenance);
            w.mobs.push(z);
            super::frost::prepare(k, w).expect("validated Frost source budget");
            (id, false)
        }
    };
    if revive {
        reset_combat(w, zid);
        if let Some(m) = w.mobs.get_mut(zid) {
            m.status = Status::Alive;
            m.core.statuses = Default::default();
            m.core.weapon.ready_at = 0.;
            m.core.vitals.immune_until = 0.;
        }
        let at = beside_owner(k, w, &w.players[owner_ix]);
        let facing = w.players[owner_ix].body.facing;
        place(w, zid, at, facing);
        if let Some(m) = w.mobs.get_mut(zid) {
            m.owner = Some(owner_id);
            if let Some(z) = &mut m.zombie {
                z.owner_displace_seq = w.players[owner_ix].motion.displace_seq;
            }
        }
    }
    sync_stats(w, owner_id, zid, revive);
}

pub(crate) fn hurt(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    zid: PlayerId,
    total: f64,
) -> f64 {
    let Some(m) = w.mobs.get(zid) else {
        return 0.;
    };
    if m.zombie.is_none() || m.status != Status::Alive {
        return 0.;
    }
    if m.owner.is_some_and(|owner| {
        w.player(owner)
            .is_some_and(|p| w.server_time < p.vitals.immune_until)
    }) {
        return 0.;
    }
    let before = m.core.vitals.hp;
    let total = total.max(0.);
    let now = w.server_time;
    let dead = {
        let m = w.mobs.get_mut(zid).unwrap();
        m.core.vitals.hp = (before - total).max(0.);
        m.last_hit_at = now;
        if m.core.vitals.hp <= 0. {
            m.status = Status::Dead;
            true
        } else {
            false
        }
    };
    if dead {
        reset_combat(w, zid);
        let (x, y) = w
            .mobs
            .get(zid)
            .map_or((0., 0.), |m| (m.core.body.x, m.core.body.y));
        ev.push(Event::Death {
            id: zid,
            x,
            y,
            by: None,
        });
        let mut hx = Hx {
            stats: Default::default(),
            fx: None,
            k,
            w,
            ev,
        };
        crate::hooks::fire(
            &mut hx,
            HookArgs::FighterOut {
                id: zid,
                cause: OutCause::Down,
            },
        );
    }
    before - w.mobs.get(zid).map_or(0., |m| m.core.vitals.hp)
}

fn remove(w: &mut World, zid: PlayerId) {
    reset_combat(w, zid);
    w.mobs.remove(zid);
}

fn eligible(w: &World, k: &MatchStatic, owner: &Player, zid: PlayerId, id: PlayerId) -> bool {
    let Some(ix) = w.fighter_idx(id) else {
        return false;
    };
    if !w.standing(ix) || !hostile(w, zid, id) {
        return false;
    }
    let t = w.core(ix);
    if crate::status_runtime::untargetable(&t.statuses.instances, w.server_time)
        || hypot(t.body.x - owner.body.x, t.body.y - owner.body.y) > PLAGUE_ZOMBIE_ASSIST_RANGE
    {
        return false;
    }
    if let Some(target) = w.player(id) {
        crate::vision::gameplay_actor_visible(
            k.collision_view(w.rt.gates_locked),
            owner,
            target,
            w.tick,
            crate::vision::WardSight::of(k, w),
        )
    } else {
        !crate::status_runtime::untargetable(&t.statuses.instances, w.server_time)
            && crate::vision::point_visible(
                k.collision_view(w.rt.gates_locked),
                owner,
                t.pos(),
                w.tick,
                crate::vision::WardSight::of(k, w),
            )
    }
}

pub(crate) fn update(cx: &mut Cx) {
    let ids: Vec<_> =
        cx.w.mobs
            .as_slice()
            .iter()
            .filter(|m| m.zombie.is_some())
            .map(|m| m.core.id)
            .collect();
    for zid in ids {
        let Some((owner_id, owner_displace)) = cx.w.mobs.get(zid).and_then(|m| {
            m.owner
                .map(|o| (o, m.zombie.as_ref().unwrap().owner_displace_seq))
        }) else {
            continue;
        };
        let Some(owner_ix) = cx.w.idx(owner_id) else {
            remove(cx.w, zid);
            continue;
        };
        if !cx.w.players[owner_ix].standing()
            || cx.w.players[owner_ix].vitals.faction != FactionId::Plague
        {
            remove(cx.w, zid);
            continue;
        }
        if owner_displace != cx.w.players[owner_ix].motion.displace_seq {
            let at = beside_owner(cx.k, cx.w, &cx.w.players[owner_ix]);
            let facing = cx.w.players[owner_ix].body.facing;
            reset_combat(cx.w, zid);
            place(cx.w, zid, at, facing);
            if let Some(m) = cx.w.mobs.get_mut(zid) {
                if let Some(z) = &mut m.zombie {
                    z.owner_displace_seq = cx.w.players[owner_ix].motion.displace_seq;
                }
            }
        }
        sync_stats(cx.w, owner_id, zid, false);
        let zombie_ix = cx.w.fighter_idx(zid).unwrap();
        if !cx.w.standing(zombie_ix)
            || crate::status_runtime::action_blocked(
                &cx.w.core(zombie_ix).statuses,
                cx.w.server_time,
            )
        {
            continue;
        }
        let owner_pos = cx.w.players[owner_ix].pos();
        let owner_facing = cx.w.players[owner_ix].body.facing;
        let lock = cx.w.players[owner_ix].weapon.targeting.target;
        let assist =
            cx.w.mobs
                .get(zid)
                .and_then(|m| m.zombie.as_ref())
                .and_then(|z| {
                    (cx.w.server_time < z.assist_until)
                        .then_some(z.target)
                        .flatten()
                });
        let target = {
            let owner = &cx.w.players[owner_ix];
            lock.filter(|id| eligible(cx.w, cx.k, owner, zid, *id))
                .or_else(|| assist.filter(|id| eligible(cx.w, cx.k, owner, zid, *id)))
        };
        let zpos = cx.w.core(zombie_ix).pos();
        let follow = hypot(zpos.x - owner_pos.x, zpos.y - owner_pos.y) > PLAGUE_ZOMBIE_ASSIST_RANGE;
        let target = if follow { None } else { target };
        let goal = target
            .and_then(|id| cx.w.fighter_idx(id).map(|ix| cx.w.core(ix).pos()))
            .unwrap_or(owner_pos);
        let a = if target.is_none() && hypot(goal.x - zpos.x, goal.y - zpos.y) <= 1e-6 {
            owner_facing
        } else {
            atan2(goal.y - zpos.y, goal.x - zpos.x)
        };
        let distance = hypot(goal.x - zpos.x, goal.y - zpos.y);
        let can_hit = target.is_some_and(|id| {
            distance <= 66.
                && cx.w.fighter_idx(id).is_some_and(|ix| {
                    has_line_of_sight(
                        cx.k.collision_map(cx.w.rt.gates_locked),
                        zpos,
                        cx.w.core(ix).pos(),
                        MASK_MOVE,
                    )
                })
        });
        let path_empty = cx.w.core(zombie_ix).motion.path.is_empty();
        let held = cx.w.core(zombie_ix).weapon.held;
        if can_hit {
            if !path_empty {
                let _ = cx.propose(zid, RawCommand::Stop { seq: None });
            }
            let _ = cx.propose(zid, RawCommand::Aim { a });
            if !held {
                let _ = cx.propose(zid, RawCommand::Attack { a, t: None });
            }
        } else {
            if held {
                let _ = cx.propose(zid, RawCommand::Release { a, t: None });
            }
            let due =
                cx.w.mobs
                    .get(zid)
                    .and_then(|m| m.zombie.as_ref())
                    .is_some_and(|z| cx.w.server_time - z.last_move_at >= 250. || path_empty);
            if (target.is_some() || distance > PLAGUE_ZOMBIE_FOLLOW_DISTANCE) && due {
                let _ = cx.propose(
                    zid,
                    RawCommand::Move {
                        x: goal.x,
                        y: goal.y,
                        seq: None,
                    },
                );
                if let Some(m) = cx.w.mobs.get_mut(zid) {
                    if let Some(z) = &mut m.zombie {
                        z.last_move_at = cx.w.server_time;
                    }
                }
            } else if target.is_none() && distance <= PLAGUE_ZOMBIE_FOLLOW_DISTANCE && !path_empty {
                let _ = cx.propose(zid, RawCommand::Stop { seq: None });
            }
        }
    }
}

pub(crate) fn regen(cx: &mut Cx) {
    let now = cx.w.server_time;
    if now % PLAGUE_ZOMBIE_REGEN_STEP_MS >= TICK_MS {
        return;
    }
    let gains: Vec<_> =
        cx.w.mobs
            .as_slice()
            .iter()
            .filter(|m| {
                m.zombie.is_some()
                    && m.status == Status::Alive
                    && m.core.vitals.hp < m.core.vitals.max_hp
            })
            .map(|m| {
                let factor = if now - m.last_hit_at < PLAGUE_ZOMBIE_REGEN_QUIET_MS {
                    PLAGUE_ZOMBIE_REGEN_COMBAT_FACTOR
                } else {
                    1.
                };
                let gain = m.core.vitals.max_hp
                    * PLAGUE_ZOMBIE_REGEN_SHARE_PER_SECOND
                    * factor
                    * PLAGUE_ZOMBIE_REGEN_STEP_MS
                    / 1000.
                    * crate::status_runtime::heal_factor(&m.core.statuses.instances, now);
                (m.core.id, gain)
            })
            .collect();
    for (id, gain) in gains {
        if let Some(m) = cx.w.mobs.get_mut(id) {
            m.core.vitals.hp = (m.core.vitals.hp + gain).min(m.core.vitals.max_hp);
        }
    }
}

pub(crate) fn movement(
    w: &World,
    core: &crate::fighter::FighterCore,
    _dt: f64,
    _stats: crate::status_runtime::StatView,
) -> f64 {
    let Some(m) = w.mobs.get(core.id) else {
        return 1.;
    };
    if m.zombie.is_none() {
        return 1.;
    }
    let Some(owner) = m.owner.and_then(|id| w.player(id)) else {
        return 1.;
    };
    let catchup = if hypot(owner.body.x - core.body.x, owner.body.y - core.body.y)
        > PLAGUE_ZOMBIE_FOLLOW_DISTANCE * 2.
    {
        1.25
    } else {
        1.
    };
    owner.modifiers.mirrors().speed_mult.max(1.) * catchup
}

pub(crate) fn after_weapons(cx: &mut Cx) {
    let ids: Vec<_> =
        cx.w.mobs
            .as_slice()
            .iter()
            .filter(|m| m.zombie.is_some())
            .map(|m| m.core.id)
            .collect();
    for zid in ids {
        let Some(owner) = cx.w.mobs.get(zid).and_then(|m| m.owner) else {
            continue;
        };
        if cx
            .w
            .mobs
            .get(zid)
            .is_some_and(|m| m.status == Status::Alive)
        {
            sync_stats(cx.w, owner, zid, false);
        }
    }
}

pub(crate) fn hit_landed(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::HitLanded { entry, amount } = args else {
        return;
    };
    if !(*amount > 0.)
        || entry.weapon.is_none()
        || entry.sig.is_some()
        || entry.dot
        || entry.passive
        || entry.derived
        || entry.ability.is_some()
    {
        return;
    }
    let Some(owner) = entry.by.and_then(|id| hx.w.credited_player(id)) else {
        return;
    };
    let Some(zid) = zombie_of(hx.w, owner) else {
        return;
    };
    if let Some(m) = hx.w.mobs.get_mut(zid) {
        if let Some(z) = &mut m.zombie {
            z.target = Some(entry.victim);
            z.assist_until = hx.w.server_time + PLAGUE_ZOMBIE_ASSIST_MS;
        }
    }
}

pub(crate) fn fighter_out(hx: &mut Hx, args: &HookArgs) {
    let HookArgs::FighterOut { id, .. } = *args else {
        return;
    };
    if hx.w.player(id).is_some() {
        let ids: Vec<_> =
            hx.w.mobs
                .as_slice()
                .iter()
                .filter(|m| m.owner == Some(id))
                .map(|m| m.core.id)
                .collect();
        for zid in ids {
            remove(hx.w, zid);
        }
    }
}

pub(crate) fn teleported(hx: &mut Hx, _args: &HookArgs) {
    let ids: Vec<_> =
        hx.w.mobs
            .as_slice()
            .iter()
            .filter(|m| m.zombie.is_some() && m.status == Status::Alive)
            .map(|m| m.core.id)
            .collect();
    for zid in ids {
        let Some(owner_id) = hx.w.mobs.get(zid).and_then(|m| m.owner) else {
            continue;
        };
        let Some(owner_ix) = hx.w.idx(owner_id) else {
            continue;
        };
        let at = beside_owner(hx.k, hx.w, &hx.w.players[owner_ix]);
        let facing = hx.w.players[owner_ix].body.facing;
        reset_combat(hx.w, zid);
        place(hx.w, zid, at, facing);
        if let Some(m) = hx.w.mobs.get_mut(zid) {
            if let Some(z) = &mut m.zombie {
                z.owner_displace_seq = hx.w.players[owner_ix].motion.displace_seq;
            }
        }
    }
}

pub(crate) fn run_ended(hx: &mut Hx, _args: &HookArgs) {
    let ids: Vec<_> =
        hx.w.mobs
            .as_slice()
            .iter()
            .filter(|m| m.zombie.is_some())
            .map(|m| m.core.id)
            .collect();
    for zid in ids {
        remove(hx.w, zid);
    }
}

/// The source `afterWeapons` anonymous link: owner max-health changes in an input apply before this tick's damage.
pub(crate) fn after_weapons_link(cx: &mut Cx) {
    after_weapons(cx);
}

/// The source's zombie packet: its interval, windup and damage are not the fist defaults.
pub(crate) fn attack_profile(
    k: &MatchStatic,
    w: &World,
    id: PlayerId,
) -> Option<(crate::content::Timings, crate::state::Packet)> {
    let m = w.mobs.get(id)?;
    m.zombie.as_ref()?;
    let owner = m.owner.and_then(|id| w.player(id))?;
    let (_, damage) = stats(owner);
    let _ = k;
    Some((
        crate::content::Timings {
            interval: PLAGUE_ZOMBIE_INTERVAL_MS / 1000.,
            windup: PLAGUE_ZOMBIE_WINDUP_MS / 1000.,
            root: 0.,
            ranged: false,
        },
        crate::state::Packet {
            raw: damage,
            phys: 1.,
            magic: 0.,
            true_: 0.,
        },
    ))
}
