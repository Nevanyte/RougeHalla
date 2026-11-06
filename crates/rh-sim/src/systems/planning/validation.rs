//! Admission of current planning reservations and retained post-planning history.
use super::*;
pub(crate) fn validate(k: &MatchStatic, w: &World) -> Result<(), String> {
    let fail = || Err("invalid private planning state".into());
    let active = enabled(k);
    if !active {
        if w.planning.is_some()
            || w.phase == Phase::Planning
            || w.plan_ends_at != 0.
            || w.players.iter().any(|p| p.plan_ready)
        {
            return fail();
        }
        return Ok(());
    }
    if w.phase == Phase::Lobby {
        if w.planning.is_some() || w.plan_ends_at != 0. || w.players.iter().any(|p| p.plan_ready) {
            return fail();
        }
        return Ok(());
    }
    let Some(plan) = w.planning.as_ref() else {
        return fail();
    };
    if plan.starters == 0
        || plan.starters > w.roster.len()
        || plan.started_humans > plan.starters
        || plan.deals.len() > plan.starters
        || w.rt.started_with as usize != plan.starters
    {
        return fail();
    }
    let planning = w.phase == Phase::Planning;
    let duration = k.config.lifecycle.rules().unwrap().plan_seconds * 1000.;
    if (planning
        && (!(duration..=w.server_time + duration).contains(&w.plan_ends_at)
            || w.plan_ends_at == 0.))
        || (!planning && w.plan_ends_at != 0.)
    {
        return fail();
    }
    if planning
        && (plan.deals.len() != w.players.len()
            || w.raid_started_at != 0.
            || w.players.iter().any(|p| p.status != crate::Status::Lobby))
    {
        return fail();
    }
    let pool = k
        .arena
        .map
        .layers()
        .map_or(0, |l| l.data().spawn_pool.len());
    let valid_index = |v: i32| {
        if pool == 0 {
            v == -1
        } else {
            v >= 0 && (v as usize) < pool
        }
    };
    let mut last = None;
    for (id, d) in &plan.deals {
        if last.is_some_and(|p| *id <= p)
            || w.roster.name(*id).is_none()
            || (planning && w.player(*id).is_none())
            || !d.spawns.into_iter().all(valid_index)
            || !(-1..=1).contains(&d.pick)
            || !d.boons.is_empty()
            || d.boon != -1
        {
            return fail();
        }
        last = Some(*id);
        let Some(sent) = &d.sent else {
            return fail();
        };
        // Normal source has no boon producer. Helper-only captures never widen checkpoint admission.
        if sent.spawns != d.spawns
            || sent.pick != d.pick
            || sent.boons != d.boons
            || sent.boon != d.boon
            || !(duration..=w.server_time + duration).contains(&sent.ends_at)
        {
            return fail();
        }
        if planning && Some(sent) != plan_for(w, *id).as_ref() {
            return fail();
        }
        if d.pick >= 0 && plan.holder(d.spawns[d.pick as usize]) != Some(*id) {
            return fail();
        }
    }
    for (i, (index, id)) in plan.holders.iter().enumerate() {
        let Some(d) = plan.deal(*id) else {
            return fail();
        };
        if *index < 0
            || !valid_index(*index)
            || plan.holders[..i].iter().any(|(other, _)| other == index)
            || d.pick < 0
            || d.spawns[d.pick as usize] != *index
        {
            return fail();
        }
    }
    let r = &plan.report;
    if r.pairs != if pool == 0 { 0 } else { plan.starters }
        || r.tier_pairs > r.pairs
        || r.same_zone_pairs > r.pairs
        || r.shared > pool
        || r.tier_pairs + r.same_zone_pairs > r.pairs
    {
        return fail();
    }
    if (pool == 0) != (r.rule == deal::Rule::None)
        || (r.rule == deal::Rule::Global && r.tier_pairs != r.pairs)
    {
        return fail();
    }
    Ok(())
}
