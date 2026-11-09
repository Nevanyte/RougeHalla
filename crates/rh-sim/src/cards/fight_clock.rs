//! Source mods.noteFights: player row ownership, late landed touches and lazy canonical memory.
use super::runtime::FightClock;
use crate::stat_fold::{EffectKind, EffectRow, WhileCond};
use crate::state::{Player, PlayerId, World};

pub(crate) fn watches_rows(rows: &[EffectRow<'_>]) -> bool {
    rows.iter()
        .any(|row| matches!(row.kind, EffectKind::While(r) if r.cond == WhileCond::FightTime))
}

fn watches(p: &Player) -> bool {
    let (rows, n) = p.build.rows(p.faction());
    watches_rows(&rows[..n])
}

/// Source store: losing the row forgets this clock, without discarding a Wish spend.
pub(crate) fn clear(p: &mut Player) {
    if let Some(r) = &mut p.card_runtime {
        r.fight = None;
        if r.wish_cast.is_none() {
            p.card_runtime = None;
        }
    }
}

fn touch(w: &mut World, id: PlayerId, now: f64) {
    let Some(p) = w.players.get_mut(id) else {
        return;
    };
    if !watches(p) {
        return;
    }
    let clock = &mut p.card_runtime.get_or_insert_with(Default::default).fight;
    match clock {
        Some(f) if now - f.last < crate::constants::CARD_FIGHT_GAP_MS => f.last = now,
        _ => {
            *clock = Some(FightClock {
                start: now,
                last: now,
            })
        }
    }
}

/// Exactly once at live mods entry, after this pass's ledger has already used its cached fold.
pub(crate) fn note_fights(w: &mut World, landed: &[crate::systems::signatures::LandedHit]) {
    let now = w.server_time;
    for h in landed {
        if let Some(by) = h.by {
            touch(w, by, now);
        }
        touch(w, h.victim, now);
    }
}

pub(crate) fn holds(clock: Option<FightClock>, now: f64, seconds: f64) -> bool {
    clock.is_some_and(|f| {
        now - f.last < crate::constants::CARD_FIGHT_GAP_MS && now - f.start >= seconds * 1000.
    })
}

pub(crate) fn validate(
    k: &crate::statics::MatchStatic,
    w: &World,
    p: &Player,
) -> Result<(), String> {
    let Some(runtime) = p.card_runtime else {
        return Ok(());
    };
    if runtime.wish_cast.is_none() && runtime.fight.is_none() {
        return Err("unproduced empty card runtime".into());
    }
    if let Some(f) = runtime.fight {
        // Baseline/Off admits fractional epochs. Only Source lifecycle establishes an absolute 50ms grid.
        let source_grid = k.config.lifecycle.rules().is_some();
        if !watches(p)
            || !f.start.is_finite()
            || !f.last.is_finite()
            || !(0. ..=w.server_time).contains(&f.start)
            || !(f.start..=w.server_time).contains(&f.last)
            || (source_grid
                && (f.start % crate::constants::TICK_MS != 0.
                    || f.last % crate::constants::TICK_MS != 0.))
        {
            return Err("invalid watched card fight clock".into());
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "fight_clock_tests.rs"]
mod tests;
