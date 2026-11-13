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
    let mut requests = std::mem::take(&mut w.pay.mob_wakes);
    let mut order = std::mem::take(&mut w.pay.mob_wake_order);
    order.clear();
    // Identical local shuffle, including synthetic measurement seat counts; no world RNG is touched.
    order.extend(0..w.players.len() as u32);
    crate::rng::action_order_in_place(k.secrets.order_salt, w.tick, &mut order);
    let used = select_wakes(k, w, &mut requests, &order);
    for &(camp, target) in &requests[..used] {
        mob_ai::wake_mates(w, camp, target);
    }
    requests.clear();
    order.clear();
    w.pay.mob_wakes = requests;
    w.pay.mob_wake_order = order;
}
/// Stable in-place compaction of the pass's owned request snapshot. Pure selection; wakes run only after it completes.
pub(crate) fn select_wakes(
    k: &MatchStatic,
    w: &World,
    requests: &mut [(u32, PlayerId)],
    order: &[u32],
) -> usize {
    let rank = |id| {
        w.idx(id)
            .and_then(|i| order.iter().position(|&s| s as usize == i))
            .unwrap_or(usize::MAX)
    };
    // Compact the owned snapshot in place. Every unread request stays ahead of the written prefix, and each camp's
    // first occurrence fixes its output order; later requests can replace only that camp's selected target.
    let mut used = 0;
    for read in 0..requests.len() {
        let (camp, target) = requests[read];
        if !mob_ai::targetable(w, target) {
            continue;
        }
        if let Some((_, held)) = requests[..used].iter_mut().find(|(c, _)| *c == camp) {
            if (rank(target), tie(k, w, target)) < (rank(*held), tie(k, w, *held)) {
                *held = target;
            }
        } else {
            requests[used] = (camp, target);
            used += 1;
        }
    }
    used
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
    let total = hits
        .iter()
        .filter(|h| h.amount > 0.)
        .map(|h| h.amount)
        .sum::<f64>();
    if w.mobs.get(id).is_some_and(|m| m.zombie.is_some()) {
        return super::plague_zombies::hurt(k, w, ev, id, total);
    }
    let m = w.mobs.get(id).expect("mob victim");
    if m.status != Status::Alive || m.kind == crate::mob_runtime::MobKind::QuestGiver {
        return 0.;
    }
    // A training dummy has no brain and never dies (legacy `mobs.ts damageMob`): a hit that would empty it refills it to
    // full, and its last-hit clock drives `mobs.resetDummies`. No camp, threat or payout is involved.
    if m.kind == crate::mob_runtime::MobKind::Dummy {
        let total = hits
            .iter()
            .filter(|h| h.amount > 0.)
            .map(|h| h.amount)
            .sum::<f64>();
        if total <= 0. {
            return 0.;
        }
        let m = w.mobs.get_mut(id).expect("mob victim");
        m.last_hit_at = now;
        let left = m.core.vitals.hp - total;
        m.core.vitals.hp = if left <= 0. {
            m.core.vitals.max_hp
        } else {
            left
        };
        return total;
    }
    let before = m.core.vitals.hp;
    let camp = m.camp;
    if total <= 0. {
        return 0.;
    }
    // Exactly the old positive-hit/present-player filter and first-insertion ordering. No hook, actor mutation or
    // payout occurs between taking the old contributor snapshot and appending it, so streaming these IDs directly
    // into the existing ordered-unique camp list observes the same player membership without a temporary Vec.
    if !k.config.training {
        let r = w.mob_runtime.as_mut().expect("mob runtime");
        if r.camps[camp as usize].state == 0 {
            r.camps[camp as usize].state = 1;
        }
        for h in hits.iter().filter(|h| h.amount > 0.) {
            if let Some(by) = h.by.filter(|by| w.player(*by).is_some()) {
                let ids = &mut w.mob_runtime.as_mut().expect("mob runtime").life[camp as usize]
                    .contributors;
                if !ids.contains(&by) {
                    ids.push(by);
                }
            }
        }
    } else if camp >= 1 {
        // A practice console camp (legacy `hurtMob` -> `noteCampContributors`, no training gate): the same filter, kept as
        // (camp ref, player) pairs in first-hit order. A training world has no map camps, so `campEngaged` does nothing.
        for h in hits.iter().filter(|h| h.amount > 0.) {
            if let Some(by) = h.by.filter(|by| w.player(*by).is_some()) {
                let pairs = &mut w.practice.as_mut().expect("practice runtime").contributors;
                if !pairs.contains(&(camp, by)) {
                    pairs.push((camp, by));
                }
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
    let mut dealt = m.regional_brain().threat.clone();
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
    // A practice-console mob can die, but a training kill pays nothing and drops nothing (legacy `payMobKill` and the
    // `queueWeapon` training guard): the death fx, the fighter-out hook and the camp wake remain.
    if k.config.training {
        kill_training_mob(k, w, ev, id, camp, killer, now);
        return before;
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
        mob_type: m.mob_type.expect("map mob has a catalog type"),
        zone: m.core.faction_id().expect("regional faction"),
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
        m.regional_brain_mut().died_at = now;
        m.regional_brain_mut().mode = BrainMode::Idle;
        m.regional_brain_mut().target = None;
        m.regional_brain_mut().threat.clear();
        m.regional_brain_mut().goal = None;
        m.regional_brain_mut().moving = false;
        m.regional_brain_mut().holding = false;
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
/// The training branch of a practice-console mob's death (legacy `killMob` with the `payMobKill`/`queueWeapon` guards):
/// the death fx names the killer, `fighterOut` fires, the camp wakes (D24), and no GV/feed/stat/weapon/chest/drop is paid.
fn kill_training_mob(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    id: PlayerId,
    camp: u32,
    killer: Option<PlayerId>,
    now: f64,
) {
    let at = w.mobs.get(id).expect("mob victim").core.pos();
    {
        let m = w.mobs.get_mut(id).expect("mob victim");
        m.status = Status::Dead;
        m.core.vitals.hp = 0.;
        m.regional_brain_mut().died_at = now;
        m.regional_brain_mut().mode = BrainMode::Idle;
        m.regional_brain_mut().target = None;
        m.regional_brain_mut().threat.clear();
        m.regional_brain_mut().goal = None;
        m.regional_brain_mut().moving = false;
        m.regional_brain_mut().holding = false;
        m.core.inputs.clear();
        m.core.motion.path.clear();
        m.core.motion.slip = None;
        super::weapons::cancel_action(&mut m.core, now);
        m.core.weapon.held = false;
        m.core.weapon.buffered_until = 0.;
    }
    // Legacy `campMobDied` -> `practiceMobDied` (a ref `state.camps` does not know): the camp's last mob pays the clear
    // reward after the pass. Read after the status flip, as legacy does; the resets above do not touch what it reads.
    if camp >= 1
        && !w
            .mobs
            .iter()
            .any(|m| m.camp == camp && m.status == Status::Alive)
    {
        super::ledger::pay_later(k, w, ev, PayLater::PracticeCampCleared { camp_ref: camp });
    }
    ev.push(Event::Death {
        id,
        x: at.x,
        y: at.y,
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
}

fn dropper(w: &World, a: &Award) -> bool {
    w.mob_runtime.as_ref().unwrap().camps[a.camp as usize].alive == 0
        && w.pay
            .mob_deaths
            .iter()
            .filter(|d| d.camp == a.camp)
            .map(|d| d.serial)
            .min()
            .is_none_or(|serial| serial == a.serial)
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
fn award_weapon(k: &MatchStatic, w: &mut World, ev: &mut Vec<Event>, a: &Award) {
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
        let id = p.id;
        crate::hooks::fire(
            &mut crate::hooks::Hx {
                stats: Default::default(),
                k,
                w,
                ev,
                fx: None,
            },
            crate::hooks::HookArgs::WeaponSwapped(id),
        );
        ev.push(Event::MobArmed {
            id,
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
    // Legacy `payMobKill`: a training world's practice mobs pay nothing (no GV, feed, stat, weapon or drop).
    if k.config.training {
        return;
    }
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
        // a7b5c4ce mobLife.ts:265-270: the stat is the camp's buff (an off-theme camp under `CampBuffRule::Themed`, paying
        // another zone's type's stat), else the mob's own type's. A `Legacy` world has no buff row.
        let buff = w
            .mob_runtime
            .as_ref()
            .and_then(|rt| rt.buffs.0.get(a.camp as usize).copied().flatten());
        let paid = buff.unwrap_or(a.mob_type);
        let gained = crate::modifiers::grant_mob_stat(
            k,
            w,
            id,
            paid,
            crate::modifiers::farm::DEFINITION.kill_stacks,
        );
        if gained > 0 {
            let count = w.players[i].farm.count(paid);
            ev.push(Event::Toast {
                to: Some(id),
                text: match buff {
                    Some(_) => crate::modifiers::farm_text::grant_notice_from(
                        a.mob_type, paid, gained, count,
                    ),
                    None => crate::modifiers::farm_text::grant_notice(paid, gained, count),
                },
            });
        }
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
            award_weapon(k, w, ev, &a);
        }
    }
    // Source payMobKill: credit, stat, the settled weapon awards and the chainable `mobKilled` hook. The chests link
    // (P-CARDS-2) runs inside the hook at its recorded chain position; the quests link stays Pending.
    crate::hooks::fire(
        &mut crate::hooks::Hx {
            stats: Default::default(),
            k,
            w,
            ev,
            fx: None,
        },
        crate::hooks::HookArgs::MobKilled {
            killer: id,
            mob_type: a.mob_type,
            zone: a.zone,
            camp: a.camp as i32,
            elite: a.elite,
            at: a.at,
            contributors: a.contributors,
        },
    );
}
#[cfg(all(test, feature = "trusted-status-probes"))]
mod mob_lifecycle_tests;
#[cfg(test)]
mod pay_tests;

pub(crate) fn reap(cx: &mut Cx) {
    if !mob_ai::enabled(cx.w) {
        return;
    }
    let now = cx.w.server_time;
    let mut gone = Vec::new();
    for i in 0..cx.w.mobs.len() {
        let m = &cx.w.mobs[i];
        if m.brain.is_none() {
            continue;
        }
        if m.status == Status::Dead {
            if now - m.regional_brain().died_at >= MOB_CORPSE_MS {
                gone.push(m.core.id)
            }
        } else if m.kind != crate::mob_runtime::MobKind::Dummy
            && m.core.vitals.hp < m.core.vitals.max_hp
            && (m.regional_brain().mode == BrainMode::Return
                || (m.regional_brain().mode == BrainMode::Idle
                    && now - m.last_hit_at >= MOB_REGEN_LOCK_MS))
        {
            let amount = m.core.vitals.max_hp * TICK_MS
                / (if m.regional_brain().mode == BrainMode::Return {
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
    if !mob_ai::enabled(cx.w) || cx.k.config.training || cx.w.phase != crate::Phase::Active {
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
                .filter(|m| {
                    m.camp == ci as u32
                        && m.kind == crate::mob_runtime::MobKind::Regional
                        && m.zombie.is_none()
                })
                .map(|m| m.core.id)
                .collect();
        for id in ids {
            cx.w.mobs.remove(id);
        }
        super::mobs::spawn_camp(cx.k, cx.w, ci);
    }
    cx.s.reserve_actors(cx.w.fighter_count());
}

/// Source mobLife.resetAllMobs -> mobAI.resetMob; the teleport producer remains staged.
pub(crate) fn teleported(hx: &mut crate::hooks::Hx, _: &crate::hooks::HookArgs) {
    let now = hx.w.server_time;
    for m in &mut hx.w.mobs {
        if m.status != Status::Alive || m.brain.is_none() {
            continue;
        }
        m.regional_brain_mut().target = None;
        m.regional_brain_mut().threat.clear();
        m.regional_brain_mut().goal = None;
        m.regional_brain_mut().last_move_at = 0.;
        m.regional_brain_mut().moving = false;
        m.regional_brain_mut().holding = false;
        m.core.inputs.clear();
        m.core.motion.path.clear();
        m.core.motion.slip = None;
        super::weapons::cancel_action(&mut m.core, now);
        m.core.weapon.held = false;
        m.core.weapon.buffered_until = 0.;
        m.core.body.x = m.home.x;
        m.core.body.y = m.home.y;
        m.core.body.facing = m.home_facing;
        m.core.vitals.hp = m.core.vitals.max_hp;
        m.core.body.history.reset(crate::state::Sample {
            t: now,
            x: m.home.x,
            y: m.home.y,
        });
        m.regional_brain_mut().mode = BrainMode::Idle;
    }
}
