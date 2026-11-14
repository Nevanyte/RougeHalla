//! Wind emblems (legacy `consumables.ts` `updateWindEmblems`). A private stream (mulberry32 of the order salt) spawns
//! walk-over emblems 8-15 s apart, at most 12 at once, on clear floor tiles at least three tiles from the others. The
//! nearest standing player within 30 u and in line of sight consumes one, gaining +50% movement speed for 5 s through the
//! stat mirrors. Training and the non-active phases never spawn or consume.
use crate::constants::{
    MASK_MOVE, PLAYER_RADIUS, SPEED_BOOST_MS, SPEED_BOOST_MULT, TILE, WIND_EMBLEM_LIMIT,
    WIND_EMBLEM_SPACING, WIND_PICKUP_RADIUS, WIND_SPAWN_MAX_MS, WIND_SPAWN_MIN_MS,
};
use crate::events::Event;
use crate::fighter::{FighterCore, FighterIx};
use crate::geometry::{circle_clear, has_line_of_sight};
use crate::hooks::{HookArgs, Hx};
use crate::math::hypot;
use crate::schedule::ModContribution;
use crate::state::{ContainerKind, Phase, World};
use crate::systems::{items, Cx};

#[cfg(test)]
#[path = "wind_tests.rs"]
mod tests;

/// Legacy `consumables.install`: seed the private stream from the FINAL order salt (the order salt itself is drawn
/// during initial-world setup) and draw the first timer. `raidStarted` re-arms it before the run.
pub(crate) fn seed_install(w: &mut World, order_salt: u32) {
    w.wind_rng = crate::rng::Mulberry32::new(order_salt ^ crate::constants::WIND_SEED_XOR);
    let first = w.wind_rng.next_f64();
    w.wind_next_at =
        w.server_time + WIND_SPAWN_MIN_MS + first * (WIND_SPAWN_MAX_MS - WIND_SPAWN_MIN_MS);
}

fn arm(w: &mut World) {
    w.wind_next_at = w.server_time
        + WIND_SPAWN_MIN_MS
        + w.wind_rng.next_f64() * (WIND_SPAWN_MAX_MS - WIND_SPAWN_MIN_MS);
}

/// Legacy `consumables.install`'s `raidStarted` link: re-arm the first timer of the run.
pub(crate) fn raid_started(hx: &mut Hx, _: &HookArgs) {
    if hx.k.config.consumables {
        arm(hx.w);
    }
}

pub(crate) fn update(cx: &mut Cx) {
    if cx.k.config.training || !cx.k.config.consumables || cx.w.phase != Phase::Active {
        return;
    }
    let now = cx.w.server_time;
    // Pickups first, in container order; an emblem born this tick cannot be taken yet.
    let mut i = 0;
    while i < cx.w.containers.len() {
        if cx.w.containers[i].kind != ContainerKind::WindEmblem {
            i += 1;
            continue;
        }
        if cx.w.containers[i].born_tick != 0 && cx.w.containers[i].born_tick >= cx.w.tick {
            i += 1;
            continue;
        }
        let at = cx.w.containers[i].at;
        // An emblem under a standing wall is not taken from beside it (P-FROST-WALL-1c).
        let held = crate::barriers::held(cx.w);
        let map = crate::barriers::body_map(cx.k, &held, cx.w.rt.gates_locked);
        let mut best: Option<(f64, u32, usize)> = None;
        for (slot, p) in cx.w.players.iter().enumerate() {
            if !p.standing() {
                continue;
            }
            let pos = p.pos();
            let d = hypot(pos.x - at.x, pos.y - at.y);
            if d > WIND_PICKUP_RADIUS || !has_line_of_sight(map, pos, at, MASK_MOVE) {
                continue;
            }
            let rank = crate::rng::tie_rank_origin(
                cx.k.secrets.order_salt,
                cx.w.tick,
                cx.w.actor_origin(p.id).expect("retained actor"),
            );
            let better = match best {
                None => true,
                Some((bd, br, _)) => d < bd || (d == bd && rank < br),
            };
            if better {
                best = Some((d, rank, slot));
            }
        }
        if let Some((_, _, slot)) = best {
            let id = cx.w.players[slot].id;
            cx.w.players[slot].speed_boost_until = now + SPEED_BOOST_MS;
            crate::modifiers::recompute_with(cx.k, cx.w, FighterIx::of_slot(slot), cx.stats);
            cx.w.containers.remove(i);
            cx.ev.push(Event::WindEmblem { id });
            continue;
        }
        i += 1;
    }
    // Spawn timer: one draw whenever it is due, before the cap check (the source advances the stream either way).
    if now < cx.w.wind_next_at {
        return;
    }
    arm(cx.w);
    let count =
        cx.w.containers
            .iter()
            .filter(|c| c.kind == ContainerKind::WindEmblem)
            .count();
    if count >= WIND_EMBLEM_LIMIT {
        return;
    }
    // A candidate on a standing wall is rejected and the stream draws again, as legacy's `collisionMap` does.
    let held = crate::barriers::held(cx.w);
    let map = crate::barriers::body_map(cx.k, &held, cx.w.rt.gates_locked);
    let (mw, mh) = (f64::from(map.w), f64::from(map.h));
    for _ in 0..40 {
        let x = ((cx.w.wind_rng.next_f64() * mw).floor() + 0.5) * TILE;
        let y = ((cx.w.wind_rng.next_f64() * mh).floor() + 0.5) * TILE;
        let at = crate::Vec2::new(x, y);
        if !circle_clear(map, at, PLAYER_RADIUS, MASK_MOVE) {
            continue;
        }
        if cx.w.containers.iter().any(|c| {
            c.kind == ContainerKind::WindEmblem
                && hypot(c.at.x - at.x, c.at.y - at.y) < TILE * WIND_EMBLEM_SPACING
        }) {
            continue;
        }
        let tick = cx.w.tick;
        items::add_wind_emblem(cx.w, at, tick);
        return;
    }
}

/// Legacy `updateConsumables`'s last loop: a boost ends on time or when its owner is no longer standing.
pub(crate) fn expire(cx: &mut Cx) {
    let now = cx.w.server_time;
    for i in 0..cx.w.players.len() {
        let over = {
            let p = &cx.w.players[i];
            p.speed_boost_until > 0. && (p.speed_boost_until <= now || !p.standing())
        };
        if over {
            cx.w.players[i].speed_boost_until = 0.;
            crate::modifiers::recompute_with(cx.k, cx.w, FighterIx::of_slot(i), cx.stats);
        }
    }
}

/// Legacy `consumables.install`'s `fighterOut` link: the boost is gone with the fighter.
pub(crate) fn fighter_out(hx: &mut Hx, args: &HookArgs) {
    if let HookArgs::FighterOut { id, .. } = *args {
        if let Some(i) = hx.w.idx(id) {
            hx.w.players[i].speed_boost_until = 0.;
        }
    }
}

/// The module's `modSources` entry: +50% movement while the emblem's boost is in the future.
pub(crate) fn speed_source(
    w: &World,
    core: &FighterCore,
    _: crate::status_runtime::StatView,
) -> Option<ModContribution> {
    let p = w.player(core.id)?;
    (p.speed_boost_until > w.server_time).then(|| ModContribution {
        speed_mult: Some(SPEED_BOOST_MULT),
        ..Default::default()
    })
}
