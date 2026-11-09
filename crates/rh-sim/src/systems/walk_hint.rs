//! Source walkHint.ts: readonly lower-bound preview, then only two player presentation bytes.
//! No gameplay, input, observer or policy consumes this state.
mod queries;
use super::Cx;
use crate::{
    constants::*,
    fighter::{FighterCore, FighterIx},
    hooks::{HookArgs, Hx},
    math::Vec2,
    schedule::Plan,
    state::{Phase, World},
    statics::MatchStatic,
    status_runtime::{self as status, stats::Inputs, StatusKind},
    terrain::Mode,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub(crate) struct WalkHint {
    pub(crate) dir: u8,
    pub(crate) ticks: u8,
}

/// Callers supply a validated player index. A missing referenced target is known world absence.
pub(crate) fn walk_hint_of(
    k: &MatchStatic,
    w: &World,
    stats: Inputs<'_>,
    ix: FighterIx,
) -> WalkHint {
    compute(k, w, ix, |_| move_factor(k, w, ix, stats))
}

// The readonly fold is supplied once, after the same early guards as source. Production
// always supplies the installed fold; declared source callback probes are test-only callers.
fn compute(
    k: &MatchStatic,
    w: &World,
    ix: FighterIx,
    movement: impl FnOnce(f64) -> f64,
) -> WalkHint {
    assert!(w.is_player(ix), "walk hints belong only to players");
    let p = &w.players[ix.slot()];
    let now = w.server_time;
    // Source isEvading is currently false for every actor.
    if w.phase != Phase::Active
        || !p.standing()
        || status::hidden(&p.statuses.instances, now)
        || status::cannot_move(&p.statuses, now)
        || p.motion.slip.is_some()
        || traction_at(k, p, p.pos()) != 0.
    {
        return WalkHint::default();
    }
    let Some(q) = p.motion.path.first() else {
        return WalkHint::default();
    };
    let dx = q.x - p.body.x;
    let dy = q.y - p.body.y;
    let segment = source_distance(dx, dy);
    if segment < WALK_HINT_SEGMENT_EPS_U {
        return WalkHint::default();
    }
    let ux = dx / segment;
    let uy = dy / segment;
    let mut multiplier = movement(0.);
    if multiplier > 0. && multiplier < MOVE_MULT_FLOOR {
        multiplier = MOVE_MULT_FLOOR;
    }
    if !(multiplier > 0.) {
        return WalkHint::default();
    }
    let speed = p.modifiers.mirrors().speed_mult;
    let haste = status::value(&p.statuses.instances, StatusKind::Haste, now);
    // Potential hunt activation is intentionally based on the retained nonempty owner target only.
    let hunt = if p.faction() == crate::FactionId::Sentenced && p.hunt_target().is_some() {
        1. + SENTENCED_HUNT_MOVE_BONUS
    } else {
        1.
    };
    let upper = multiplier
        .max(
            speed
                * hunt
                * if haste > 0. {
                    status::haste_multiplier(speed, haste)
                } else {
                    1.
                },
        )
        .max(1.)
        * WALK_HINT_SPEED_SLACK;
    let step = PLAYER_SPEED * upper * TICK_MS / 1000.;
    let weapon = p.active_weapon();
    let tm = queries::timings(p);
    let locked = p.weapon.targeting.target.is_some();
    let amove =
        !locked && p.weapon.targeting.attack_move.is_some() && weapon == crate::WeaponId::Wand;
    let mut held_next = None;
    if locked {
        let Some(hold) = queries::lock_next(k, w, ix.slot(), now + TICK_MS) else {
            return WalkHint::default();
        };
        held_next = Some(hold);
    }
    if amove && queries::acquire_next(k, w, ix.slot(), now + TICK_MS) {
        return WalkHint::default();
    }
    let cap = if locked || amove {
        1
    } else {
        WALK_HINT_MAX_TICKS
    };
    let mut ticks = 0;
    for j in 1..=cap {
        let at = now + f64::from(j) * TICK_MS;
        let distance = f64::from(j) * step;
        if distance > segment + WALK_HINT_WAYPOINT_SLACK_U
            || queries::held_at(p, now, at, tm, if j == 1 { held_next } else { None })
            || ice_along(k, p, ux, uy, distance)
        {
            break;
        }
        ticks = j;
    }
    if ticks == 0 {
        WalkHint::default()
    } else {
        WalkHint {
            dir: encode_dir(crate::math::atan2(dy, dx)),
            ticks,
        }
    }
}

fn source_distance(dx: f64, dy: f64) -> f64 {
    debug_assert!(
        dx.is_finite() && dy.is_finite(),
        "validated world coordinates"
    );
    crate::mapgen::certify::source_hypot(dx, dy)
}

/// Literal JS Math.round(a*128/PI)&255, including negative half ties and adjacent floats.
fn encode_dir(a: f64) -> u8 {
    (crate::math::js_round(a * 128. / std::f64::consts::PI) as i32 & 255) as u8
}

/// Fold the installed registration order/gates, never the current weapon root. dt0 bog is purely read.
fn move_factor(k: &MatchStatic, w: &World, ix: FighterIx, stats: Inputs<'_>) -> f64 {
    let mut value = 1.;
    for &(name, _) in Plan::of(k).move_modifiers.live() {
        value *= move_value(name, k, w, ix, stats);
    }
    value
}

fn move_value(name: &str, k: &MatchStatic, w: &World, ix: FighterIx, stats: Inputs<'_>) -> f64 {
    let p = w.core(ix);
    let view = stats.view(p);
    match name {
        "factions.frostMovementModifier" => super::frost::movement_modifier(w, p, 0., view),
        "buffs.moveSpeedMult" => crate::modifiers::movement(w, p, 0., view),
        "mobLife.mobRoleMove" => super::mobs::role_move(w, p, 0., view),
        "terrainEffects.applyBog" => super::terrain::bog_value(k, w, ix, view),
        "abilities.statusMoveMultiplier" => super::status::movement(w, p, 0., view),
        "sentencedHunt.huntMoveMultiplier" => super::sentenced_hunt::movement(k, w, ix, 0., view),
        "plagueZombies.<anonymous>" => super::plague_zombies::movement(w, p, 0., view),
        _ => unreachable!("registered movement modifier lacks a readonly hint query: {name}"),
    }
}

fn traction_at(k: &MatchStatic, p: &FighterCore, at: Vec2) -> f64 {
    if !k.hazards.slip {
        return 0.;
    }
    crate::terrain::at(
        &k.arena.map,
        at.x,
        at.y,
        (k.config.hazards != Mode::All)
            .then(|| p.faction_id())
            .flatten(),
    )
    .accel
}

fn ice_along(k: &MatchStatic, p: &FighterCore, ux: f64, uy: f64, distance: f64) -> bool {
    let n = (distance / WALK_HINT_ICE_PROBE_U).ceil().max(1.) as usize;
    for i in 1..=n {
        let d = distance * i as f64 / n as f64;
        if traction_at(k, p, Vec2::new(p.body.x + ux * d, p.body.y + uy * d)) != 0. {
            return true;
        }
    }
    false
}

pub(crate) fn update(cx: &mut Cx) {
    for i in 0..cx.w.players.len() {
        let hint = walk_hint_of(cx.k, cx.w, cx.stats, FighterIx::of_slot(i));
        let p = &mut cx.w.players[i];
        if hint.ticks > 0 {
            let d = u16::from(hint.dir.abs_diff(p.walk_dir));
            if p.walk_ticks == 0 || d.min(256 - d) >= u16::from(WALK_DIR_HYSTERESIS) {
                p.walk_dir = hint.dir;
            }
        }
        p.walk_ticks = hint.ticks;
    }
}

/// Append after the existing Teleported/RunEnded hooks; a zero hint retains its direction byte.
pub(crate) fn zero_all(hx: &mut Hx, _: &HookArgs) {
    for p in &mut hx.w.players {
        p.walk_ticks = 0;
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod helper_tests;
