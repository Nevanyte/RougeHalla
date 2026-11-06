//! Regional damage, whole-fight attribution, and deferred progression on the shared ledger.
use super::{
    ledger::{Hit, PayLater},
    mob_ai, Cx,
};
use crate::{
    constants::*,
    events::Event,
    fighter::FighterIx,
    mob_runtime::{ActorOrigin, BrainMode},
    state::{ContainerKind, Status, World},
    statics::MatchStatic,
    PlayerId, Vec2, WeaponId,
};
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Award {
    pub mob: PlayerId,
    pub serial: u32,
    pub killer: Option<PlayerId>,
    pub camp: u32,
    pub weapon: WeaponId,
    pub at: Vec2,
    pub elite: bool,
    pub mob_type: crate::mob_catalog::MobTypeId,
    pub zone: crate::FactionId,
    pub mult: f64,
    pub contributors: Vec<PlayerId>,
}
fn feed(p: &crate::state::Player) -> f64 {
    f64::from(p.credit.kills) + MOB_FEED_WEIGHT * f64::from(p.credit.mob_kills)
}
pub(crate) fn open(w: &mut World) {
    w.pay.mob_wakes.clear();
    w.pay.mob_deaths.clear();
    w.pay.mob_settled.clear();
    w.pay.mob_feeds.clear();
    if !mob_ai::enabled(w) {
        return;
    }
    for p in &w.players {
        if p.standing() {
            w.pay.mob_feeds.push(feed(p));
        }
    }
    let feeds = &mut w.pay.mob_feeds;
    feeds.sort_by(f64::total_cmp);
    let n = feeds.len();
    w.pay.median_feed = if n == 0 {
        0.
    } else if n % 2 == 1 {
        feeds[n / 2]
    } else {
        (feeds[n / 2 - 1] + feeds[n / 2]) / 2.
    };
    feeds.clear();
}

fn reward(w: &World, id: PlayerId) -> f64 {
    let f = w.player(id).map_or(0., feed);
    let curve = MOB_REWARD_FLOOR
        + (1. - MOB_REWARD_FLOOR)
            * (1. - 1. / (1. + crate::math::exp(-(f - MOB_REWARD_MID) / MOB_REWARD_WIDTH)));
    curve
        * if f < w.pay.median_feed - MOB_CATCHUP_GAP {
            MOB_CATCHUP_MULT
        } else {
            1.
        }
}
fn tie(k: &MatchStatic, w: &World, id: PlayerId) -> u32 {
    crate::rng::tie_rank_origin(
        k.secrets.order_salt,
        w.tick,
        w.actor_origin(id).expect("retained actor"),
    )
}
pub(crate) fn request_wake(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    camp: u32,
    target: PlayerId,
) {
    if !mob_ai::targetable(w, target) {
        return;
    }
    if w.pay.collecting {
        if w.pay.mob_wakes.is_empty() {
            super::ledger::pay_later(k, w, ev, PayLater::MobWakes);
        }
        w.pay.mob_wakes.push((camp, target));
    } else {
        mob_ai::wake_mates(w, camp, target);
    }
}
pub(crate) fn settle_wakes(k: &MatchStatic, w: &mut World) {
    let requests = std::mem::take(&mut w.pay.mob_wakes);
    let mut first: Vec<(u32, PlayerId)> = Vec::new();
    // Action order is recomputed from the same current seats; no structural mutations occur during the pass.
    let mut order: Vec<u32> = (0..w.players.len() as u32).collect();
    crate::rng::action_order_in_place(k.secrets.order_salt, w.tick, &mut order);
    let rank = |id| {
        w.idx(id)
            .and_then(|i| order.iter().position(|&s| s as usize == i))
            .unwrap_or(usize::MAX)
    };
    for &(camp, target) in &requests {
        if !mob_ai::targetable(w, target) {
            continue;
        }
        if let Some((_, held)) = first.iter_mut().find(|(c, _)| *c == camp) {
            if (rank(target), tie(k, w, target)) < (rank(*held), tie(k, w, *held)) {
                *held = target;
            }
        } else {
            first.push((camp, target));
        }
    }
    for (camp, target) in first {
        mob_ai::wake_mates(w, camp, target);
    }
    w.pay.mob_wakes = requests;
    w.pay.mob_wakes.clear();
}
/// `hits` is ledger insertion order for a mob; its mitigation already ran in the common pass.
pub(crate) fn hurt(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    ix: FighterIx,
    hits: &[Hit],
) -> f64 {
    let id = w.core(ix).id;
    let now = w.server_time;
    let m = w.mobs.get(id).expect("mob victim");
    if m.status != Status::Alive {
        return 0.;
    }
    let before = m.core.vitals.hp;
    let camp = m.camp;
    let total = hits
        .iter()
        .filter(|h| h.amount > 0.)
        .map(|h| h.amount)
        .sum::<f64>();
    if total <= 0. {
        return 0.;
    }
    let contributors: Vec<_> = hits
        .iter()
        .filter(|h| h.amount > 0.)
        .filter_map(|h| h.by)
        .filter(|id| w.player(*id).is_some())
        .collect();
    {
        let r = w.mob_runtime.as_mut().expect("mob runtime");
        if r.camps[camp as usize].state == 0 {
            r.camps[camp as usize].state = 1;
        }
        for id in contributors {
            let ids = &mut r.life[camp as usize].contributors;
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    {
        let m = w.mobs.get_mut(id).unwrap();
        m.core.vitals.hp = (before - total).max(0.);
        m.last_hit_at = now;
    }
    if before > total {
        for h in hits {
            if let Some(by) = h.by {
                if let Some((camp, target)) = mob_ai::aggro(w, id, by, h.amount) {
                    request_wake(k, w, ev, camp, target);
                }
            }
        }
        return total;
    }
    let m = w.mobs.get(id).unwrap();
    let mut dealt = m.brain.threat.clone();
    dealt.retain(|(id, _)| w.player(*id).is_some_and(|p| !p.resolved));
    let share = if total > before { before / total } else { 1. };
    for h in hits {
        if h.amount > 0. {
            if let Some(by) = h.by.filter(|id| w.player(*id).is_some_and(|p| !p.resolved)) {
                if let Some((_, sum)) = dealt.iter_mut().find(|(id, _)| *id == by) {
                    *sum += h.amount * share
                } else {
                    dealt.push((by, h.amount * share));
                }
            }
        }
    }
    let mut killer = None;
    let mut best = 0.;
    for (id, sum) in dealt {
        if sum > best || (sum == best && killer.is_some_and(|held| tie(k, w, id) < tie(k, w, held)))
        {
            best = sum;
            killer = Some(id);
        }
    }
    let m = w.mobs.get(id).unwrap();
    let serial = match w.actor_origin(id) {
        Some(ActorOrigin::Mob { birth_serial, .. }) => *birth_serial,
        _ => unreachable!(),
    };
    let award = Award {
        mob: id,
        serial,
        killer,
        camp,
        weapon: m.core.active_weapon(),
        at: m.core.pos(),
        elite: m.elite,
        mob_type: m.mob_type,
        zone: m.core.vitals.faction,
        mult: killer.map_or(1., |p| reward(w, p)),
        contributors: if m.elite {
            w.mob_runtime.as_ref().unwrap().life[camp as usize]
                .contributors
                .clone()
        } else {
            Vec::new()
        },
    };
    {
        let r = w.mob_runtime.as_mut().unwrap();
        let c = &mut r.camps[camp as usize];
        c.alive = c.alive.saturating_sub(1);
        if c.alive == 0 && c.state != 2 {
            c.state = 2;
            c.cleared_at = now;
            c.respawn_at = now + CAMP_RESPAWN_MS;
            let life = &mut r.life[camp as usize];
            life.ward_owner = killer;
            life.ward_expires_at = if killer.is_some() {
                now + CAMP_WARD_MS
            } else {
                0.
            };
            super::ledger::pay_later(k, w, ev, PayLater::CampCleared { camp });
        }
    }
    {
        let m = w.mobs.get_mut(id).unwrap();
        m.status = Status::Dead;
        m.core.vitals.hp = 0.;
        m.brain.died_at = now;
        m.brain.mode = BrainMode::Idle;
        m.brain.target = None;
        m.brain.threat.clear();
        m.brain.goal = None;
        m.brain.moving = false;
        m.brain.holding = false;
        m.core.inputs.clear();
        m.core.motion.path.clear();
        m.core.motion.slip = None;
        super::weapons::cancel_action(&mut m.core, now);
        m.core.weapon.held = false;
        m.core.weapon.buffered_until = 0.;
    }
    ev.push(Event::Death {
        id,
        x: award.at.x,
        y: award.at.y,
        by: killer,
    });
    crate::hooks::fire(
        &mut crate::hooks::Hx {
            k,
            w,
            ev,
            fx: None,
            stats: Default::default(),
        },
        crate::hooks::HookArgs::FighterOut {
            id,
            cause: crate::hooks::OutCause::Down,
        },
    );
    if let Some(target) = killer {
        request_wake(k, w, ev, camp, target);
    }
    w.pay.mob_deaths.push(award.clone());
    super::ledger::pay_later(k, w, ev, PayLater::MobKill { award });
    before
}
fn dropper(w: &World, a: &Award) -> bool {
    w.mob_runtime.as_ref().unwrap().camps[a.camp as usize].alive == 0
        && w.pay
            .mob_deaths
            .iter()
            .filter(|d| d.camp == a.camp)
            .map(|d| d.serial)
            .min()
            == Some(a.serial)
}
fn drop_weapon(w: &mut World, a: &Award) {
    if a.weapon != WeaponId::Fists {
        super::items::add_container(
            w,
            ContainerKind::Ground,
            a.at,
            [Some(a.weapon), None],
            w.tick,
            false,
        );
    }
}
fn award_weapon(w: &mut World, ev: &mut Vec<Event>, a: &Award) {
    if a.weapon == WeaponId::Fists {
        return;
    }
    let Some(i) = a.killer.and_then(|id| w.idx(id)) else {
        if dropper(w, a) {
            drop_weapon(w, a)
        }
        return;
    };
    let p = &mut w.players[i];
    let empty = if p.weapon.slot == 0 {
        p.weapon.weapon0.is_none()
    } else {
        p.weapon.weapon1.is_none()
    };
    if p.standing() && empty {
        if p.weapon.slot == 0 {
            p.weapon.weapon0 = Some(a.weapon)
        } else {
            p.weapon.weapon1 = Some(a.weapon)
        }
        super::items::weapon_changed(p, w.server_time);
        ev.push(Event::MobArmed {
            id: p.id,
            weapon: a.weapon,
        });
        return;
    }
    if dropper(w, a)
        && w.players[i].weapon.weapon0 != Some(a.weapon)
        && w.players[i].weapon.weapon1 != Some(a.weapon)
    {
        drop_weapon(w, a)
    }
}
pub(crate) fn pay(k: &MatchStatic, w: &mut World, ev: &mut Vec<Event>, a: Award) {
    let Some(id) = a.killer else {
        if dropper(w, &a) {
            drop_weapon(w, &a)
        }
        return;
    };
    let Some(i) = w.idx(id).filter(|&i| !w.players[i].resolved) else {
        if dropper(w, &a) {
            drop_weapon(w, &a)
        }
        return;
    };
    w.players[i].credit.mob_kills = w.players[i].credit.mob_kills.saturating_add(1);
    let amount =
        ((if a.elite { MOB_GV_ELITE } else { MOB_GV_NORMAL }) as f64 * a.mult).round() as u32;
    let amount = amount.min(
        crate::reward_chests::DEFINITION
            .mob_gv_cap
            .saturating_sub(w.players[i].credit.gv_parts.mobs),
    );
    super::credit::credit(
        w,
        ev,
        i,
        if a.elite {
            crate::results::GvReason::Elite
        } else {
            crate::results::GvReason::Mob
        },
        amount,
    );
    if !a.elite {
        crate::modifiers::grant_mob_stat(
            k,
            w,
            id,
            a.mob_type,
            crate::modifiers::farm::DEFINITION.kill_stacks,
        );
    }
    if !w.pay.mob_settled.contains(&id) {
        w.pay.mob_settled.push(id);
        let mut awards: Vec<_> = w
            .pay
            .mob_deaths
            .iter()
            .filter(|d| d.killer == Some(id))
            .cloned()
            .collect();
        awards.sort_by_key(|d| d.serial);
        for a in awards {
            award_weapon(w, ev, &a);
        }
    }
    if a.elite {
        if let Some(c) = k
            .arena
            .map
            .layers()
            .and_then(|l| l.data().camps.get(a.camp as usize))
        {
            let at = if k.arena.map.is_solid(
                (c.chest.x / TILE).floor() as i64,
                (c.chest.y / TILE).floor() as i64,
            ) {
                Vec2::new(c.x, c.y)
            } else {
                Vec2::new(c.chest.x, c.chest.y)
            };
            let eligible: Vec<_> = a
                .contributors
                .into_iter()
                .filter(|id| {
                    w.player(*id).is_some_and(|p| {
                        p.standing()
                            && (mob_ai::territory(k, p.pos()) == a.camp + 1
                                || crate::math::hypot(p.body.x - c.x, p.body.y - c.y)
                                    <= CAMP_HEAL_RANGE)
                    })
                })
                .collect();
            crate::reward_chests::drop_augment(w, at, Some(a.camp as u16), a.zone, true, &eligible);
        }
    }
}
pub(crate) fn reap(cx: &mut Cx) {
    if !mob_ai::enabled(cx.w) {
        return;
    }
    let now = cx.w.server_time;
    let mut gone = Vec::new();
    for i in 0..cx.w.mobs.len() {
        let m = &cx.w.mobs[i];
        if m.status == Status::Dead {
            if now - m.brain.died_at >= MOB_CORPSE_MS {
                gone.push(m.core.id)
            }
        } else if m.core.vitals.hp < m.core.vitals.max_hp
            && (m.brain.mode == BrainMode::Return
                || (m.brain.mode == BrainMode::Idle && now - m.last_hit_at >= MOB_REGEN_LOCK_MS))
        {
            let amount = m.core.vitals.max_hp * TICK_MS
                / (if m.brain.mode == BrainMode::Return {
                    MOB_RETURN_REGEN_SECONDS
                } else {
                    MOB_REGEN_SECONDS
                } * 1000.);
            let ix = FighterIx::of_slot(cx.w.players.len() + i);
            let stats = cx.stats.view(&m.core);
            super::heal::apply_with(
                cx.w,
                cx.ev,
                ix.slot(),
                amount,
                super::heal::Kind::QuietRegen,
                stats,
            );
        }
    }
    for id in gone {
        cx.w.mobs.remove(id);
    }
}

pub(crate) fn respawn(cx: &mut Cx) {
    if !mob_ai::enabled(cx.w) || cx.w.phase != crate::Phase::Active {
        return;
    }
    let count = cx.w.mob_runtime.as_ref().unwrap().camps.len();
    for ci in 0..count {
        let c = &cx.w.mob_runtime.as_ref().unwrap().camps[ci];
        if c.state != 2 || c.alive != 0 || c.respawn_at <= 0. || cx.w.server_time < c.respawn_at {
            continue;
        }
        let ids: Vec<_> =
            cx.w.mobs
                .iter()
                .filter(|m| m.camp == ci as u32)
                .map(|m| m.core.id)
                .collect();
        for id in ids {
            cx.w.mobs.remove(id);
        }
        super::mobs::spawn_camp(cx.k, cx.w, ci);
    }
    cx.s.reserve_actors(cx.w.fighter_count());
}
