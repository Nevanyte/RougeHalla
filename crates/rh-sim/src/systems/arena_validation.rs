//! Source lifecycle invariants for checkpoints, separate from ordered mutation code.
use crate::{
    state::{Phase, World},
    statics::MatchStatic,
};
pub(crate) fn validate(k: &MatchStatic, w: &World) -> Result<(), String> {
    super::arena_rules::validate_config(k).map_err(str::to_owned)?;
    let fail = || Err("invalid source arena lifecycle state".into());
    for slot in 0..w.fighter_count() {
        if w.core(crate::fighter::FighterIx::of_slot(slot))
            .weapon
            .last_shot_at
            .is_some_and(|t| !(0. ..=w.server_time).contains(&t))
        {
            return fail();
        }
    }
    let Some(r) = k.config.lifecycle.rules() else {
        return if w.rt.gates_locked
            || w.rt.in_coliseum
            || w.rt.sudden_death_at != 0.
            || w.rt.patience_ends_at.is_some()
            || (w.rt.voided && w.phase != Phase::Active)
        {
            fail()
        } else {
            Ok(())
        };
    };
    if k.config.abilities == crate::abilities::Mode::Full {
        crate::abilities::checkpoint::validate(k, w)?;
    } else if (0..w.fighter_count()).any(|slot| {
        w.core(crate::fighter::FighterIx::of_slot(slot))
            .statuses
            .cast
            .is_some()
    }) {
        return Err("Source lifecycle has no admitted Wish cast producer; bare CastFact is a trusted Off kernel state".into());
    }
    if !w.deferred.hits.is_empty() {
        return Err(
            "Source lifecycle has no admitted deferred card producer or reset hooks".into(),
        );
    }
    if w.server_time != f64::from(w.tick) * crate::constants::TICK_MS
        || w.rt.started_with as usize > w.roster.len()
        || w.rt.started_humans > w.rt.started_with as usize
    {
        return fail();
    }
    let mut main = crate::rng::Mulberry32::new(k.secrets.spawn_seed);
    if k.secrets.order_salt != main.next_u32() {
        return fail();
    }
    let now = w.server_time;
    let teleported = w.abilities.as_ref().and_then(|a| a.teleported_at);
    if matches!(w.phase, Phase::Lobby | Phase::Planning) && teleported.is_some() {
        return Err("source teleport clock cannot precede the raid".into());
    }
    let earliest = earliest_teleport(r, w);

    if teleported
        .is_some_and(|at| at < earliest || at > now || at % crate::constants::TICK_MS != 0.)
        || (teleported.is_none() && w.players.iter().any(|p| p.vision.has_locked_reveals()))
    {
        return fail();
    }

    let first_locked_tick = (earliest / crate::constants::TICK_MS) as u32;
    if w.players
        .iter()
        .any(|p| !p.vision.locked_reveals_since(first_locked_tick))
    {
        return fail();
    }
    if !(0. ..=now + 86_400_000.).contains(&w.lobby_ends_at)
        || !(0. ..=now).contains(&w.raid_started_at)
        || !(0. ..=now + 86_400_000.).contains(&w.rt.sudden_death_at)
        || w.rt
            .patience_ends_at
            .is_some_and(|t| !(0. ..=now + 259_200_000.).contains(&t))
    {
        return fail();
    }
    match w.phase {
        Phase::Lobby | Phase::Planning => {
            if w.raid_started_at != 0.
                || w.rt.gates_locked
                || w.rt.in_coliseum
                || w.rt.sudden_death_at != 0.
                || w.rt.patience_ends_at.is_some()
                || w.rt.started_humans != 0
                || w.winner.is_some()
            {
                return fail();
            }
            if w.phase == Phase::Lobby && (w.rt.started_with != 0 || w.rt.voided) {
                return fail();
            }
            // Neither verified core module mutates these streams before the source deal.
            if !k.config.initial_loot && w.spawn_rng != main {
                return fail();
            }
        }
        Phase::Active => {
            if w.raid_started_at <= 0. || w.rt.started_with == 0 || w.winner.is_some() {
                return fail();
            }
            if w.rt.gates_locked {
                let duration = r.sudden_death_seconds * 1000.;
                let teleport_at = ((w.rt.sudden_death_at - duration) / crate::constants::TICK_MS)
                    .round()
                    * crate::constants::TICK_MS;
                if !w.rt.in_coliseum
                    || w.rt.patience_ends_at.is_some()
                    || teleport_at < earliest
                    || teleport_at > now
                    || w.rt.sudden_death_at != teleport_at + duration
                    || w.abilities.as_ref().and_then(|a| a.teleported_at) != Some(teleport_at)
                {
                    return fail();
                }
            } else {
                if w.rt.in_coliseum || w.rt.sudden_death_at != 0. {
                    return fail();
                }
                if w.rt.patience_ends_at.is_none() {
                    let Some(schedule) = r.schedule() else {
                        return fail();
                    };
                    if schedule.repeat_seconds > 0.
                        || w.abilities.as_ref().and_then(|a| a.teleported_at).is_none()
                        || super::arena_rules::slot_at(
                            w.raid_started_at,
                            now + schedule.min_gap_seconds * 1000.,
                            schedule,
                        )
                        .is_some()
                    {
                        return fail();
                    }
                }
            }
        }
        Phase::Ended => {
            if w.rt.voided
                || w.raid_started_at <= 0.
                || w.rt.gates_locked
                || w.rt.sudden_death_at != 0.
                || w.rt.patience_ends_at.is_some()
            {
                return fail();
            }
            // Source deliberately preserves inColiseum at terminal settlement.
        }
    }
    Ok(())
}

/// A lower bound on every actual lock, including retained history from an earlier cycle.
/// Timers are checked only in Active settlement. A death/reset returns from settlement,
/// so even a zero-duration timer cannot teleport on the tick that produced it.
fn earliest_teleport(r: &super::arena_rules::ArenaRules, w: &World) -> f64 {
    use crate::constants::TICK_MS;
    let next_due = |produced: f64, duration: f64| {
        (((produced + duration) / TICK_MS).ceil() * TICK_MS).max(produced + TICK_MS)
    };
    if let Some(schedule) = r.schedule() {
        // Outside scheduled deaths preserve the initial slot; rescheduling starts only
        // after the first lock. Thus no later cycle can precede this first deadline.
        return next_due(w.raid_started_at, schedule.first_seconds * 1000.);
    }
    // leavePlanning stops editing deals when Active starts: this retained count is
    // exactly the live roster at startRaid, even after later removals. Without planning,
    // beginRun records that same count directly in started_with.
    let initial = w
        .planning
        .as_ref()
        .map_or(w.rt.started_with as usize, |p| p.deals.len());
    let patience = |alive| {
        super::arena_rules::patience_seconds(alive, r.patience_seconds, r.patience_min_seconds)
            * 1000.
    };
    let first = match r.first_patience_seconds {
        Some(s) if s > 0. => s * 1000.,
        _ => patience(initial),
    };
    let mut earliest = next_due(w.raid_started_at, first);
    let standing = w.players.iter().filter(|p| p.standing()).count();
    let minimum_survivors = if w.rt.started_with >= 2 { 2 } else { 1 };
    if standing < initial && initial > minimum_survivors {
        // A prior real death may shorten an unscheduled first timer. Consider every
        // survivor count that could have reset it before terminal settlement; the
        // full/min endpoints need not be ordered by configuration.
        let shortest = (minimum_survivors..initial)
            .map(patience)
            .fold(f64::INFINITY, f64::min);
        earliest = earliest.min(next_due(w.raid_started_at + TICK_MS, shortest));
    }
    earliest
}
