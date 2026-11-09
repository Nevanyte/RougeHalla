//! Readonly future weapon/lock/acquisition queries. No vision refresh, path search, or trigger mutation.
use super::*;
use crate::{
    combat_policy::{self, Move},
    content::{mirror_timings, paced, Timings},
    geometry::has_line_of_sight,
    state::ActionKind,
    WeaponId,
};

pub(super) fn weapon_holds_at(p: &FighterCore, at: f64) -> bool {
    let w = &p.weapon;
    if at < w.root_until {
        return true;
    }
    if let Some(action) = w.action.filter(|a| at + TIE_EPS_MS < a.lands_at) {
        return action.kind == ActionKind::Swing || at >= action.lands_at - RANGED_RELEASE_PAUSE_MS;
    }
    false
}

/// Source timingsOf/mirrorTimings for this validated player, including the synced windup mirror.
pub(super) fn timings(p: &FighterCore) -> Option<Timings> {
    let weapon = if p.weapon.slot == 0 {
        p.weapon.weapon0
    } else {
        p.weapon.weapon1
    }?;
    let mirrors = p.modifiers.mirrors();
    Some(mirror_timings(
        &paced(p.faction_id()?),
        weapon,
        mirrors.as_mult,
        mirrors.windup_mult,
        false,
    ))
}

pub(super) fn held_at(
    p: &FighterCore,
    now: f64,
    at: f64,
    tm: Option<Timings>,
    held_override: Option<bool>,
) -> bool {
    if weapon_holds_at(p, at) {
        return true;
    }
    let Some(tm) = tm.filter(|t| !(t.windup <= 0. && t.root <= 0.)) else {
        return false;
    };
    let w = &p.weapon;
    if !(held_override.unwrap_or(w.held) || w.buffered_until >= w.ready_at) {
        return false;
    }
    let start = w.ready_at.max(w.action.map_or(0., |a| a.lands_at)).max(now);
    let hold_from = start
        + if tm.ranged {
            (tm.windup * 1000. - RANGED_RELEASE_PAUSE_MS).max(0.)
        } else {
            0.
        };
    at >= hold_from - TIE_EPS_MS
}

/// Some(hold) means the next lock query leaves the existing path free; None means drop/stop/replan.
pub(super) fn lock_next(k: &MatchStatic, w: &World, i: usize, at: f64) -> Option<bool> {
    let p = &w.players[i];
    let lock = &p.weapon.targeting;
    let target = w.fighter_idx(lock.target?)?;
    let other = w.core(target);
    let tm = (p.active_weapon() == WeaponId::Wand)
        .then(|| timings(p))
        .flatten()?;
    if !super::super::targeting::lockable_now(k, w, i, target.slot())
        || status::untargetable(&other.statuses.instances, at)
    {
        return None;
    }
    let seen = has_line_of_sight(
        k.collision_map(w.rt.gates_locked),
        p.pos(),
        other.pos(),
        MASK_SIGHT,
    );
    // Wand's source reachMask is MASK_SIGHT, so clear is exactly seen.
    if !seen
        && lock.seen
        && lock
            .lost_at
            .is_some_and(|lost| lost > 0. && at - lost >= TARGET_LOS_GRACE_MS)
    {
        return None;
    }
    let out = combat_policy::decide(
        combat_policy::Input {
            from: p.pos(),
            to: other.pos(),
            vel: super::super::targeting::velocity(other, at),
            los: seen,
            weapon: WeaponId::Wand,
            windup: tm.windup,
            lock: true,
            delay: 0.,
        },
        |_, _| true,
    );
    match out.movement {
        Move::Stop => return None,
        Move::Point(goal) => {
            let moved = lock.goal.is_none_or(|old| {
                source_distance(goal.x - old.x, goal.y - old.y) > TARGET_GOAL_MOVED
            });
            if (moved || p.motion.path.is_empty())
                && lock
                    .plan_at
                    .is_none_or(|last| at - last >= TARGET_REPATH_MS)
            {
                return None;
            }
        }
    }
    Some(out.hold)
}

pub(super) fn acquire_next(k: &MatchStatic, w: &World, i: usize, at: f64) -> bool {
    let p = &w.players[i];
    let range = combat_policy::spacing(WeaponId::Wand, true).attack;
    for slot in 0..w.fighter_count() {
        let ix = FighterIx::of_slot(slot);
        let candidate = w.core(ix);
        if source_distance(candidate.body.x - p.body.x, candidate.body.y - p.body.y) > range
            || status::untargetable(&candidate.statuses.instances, at)
        {
            continue;
        }
        let now = super::super::targeting::lockable_now(k, w, i, slot)
            || (status::untargetable(&candidate.statuses.instances, w.server_time)
                && w.standing(ix)
                && super::super::plague_zombies::hostile(w, p.id, candidate.id));
        if now
            && has_line_of_sight(
                k.collision_map(w.rt.gates_locked),
                p.pos(),
                candidate.pos(),
                MASK_SIGHT,
            )
        {
            return true;
        }
    }
    false
}
