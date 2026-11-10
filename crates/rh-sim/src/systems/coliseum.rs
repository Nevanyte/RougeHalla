//! Source arena.ts spatial placement, teleport hook producer and post-death timer policy.
use crate::{
    constants::*,
    geometry,
    hooks::{self, HookArgs, Hx},
    math::{self, Vec2},
    pathfind::Pathfinder,
    state::{Sample, World},
    statics::MatchStatic,
    Event,
};
pub(crate) const SPOT_SEARCH_TILES: i64 = 12;
pub(crate) const RING_RADIUS: f64 = 5. * TILE;
pub(crate) const IMMUNITY_MS: f64 = 1500.;
pub(crate) fn spots(arena: &crate::Arena, n: usize) -> Vec<Vec2> {
    let map = &arena.map;
    let mut out = Vec::with_capacity(n);
    if let Some(l) = map.layers() {
        let c = l.coliseum();
        if c.inner_spawns.len() >= n {
            let mut used = vec![false; c.inner_spawns.len()];
            for i in 0..n {
                let angle = (2. * math::PI * i as f64) / n.max(1) as f64;
                let want = Vec2::new(
                    c.centre.x + math::cos(angle) * RING_RADIUS,
                    c.centre.y + math::sin(angle) * RING_RADIUS,
                );
                let mut best = None;
                let mut dist = f64::INFINITY;
                for (j, p) in c.inner_spawns.iter().enumerate() {
                    let d = math::hypot(p.x - want.x, p.y - want.y);
                    if !used[j] && d < dist {
                        best = Some(j);
                        dist = d;
                    }
                }
                let index = best.expect("source inner spawn count");
                used[index] = true;
                let p = c.inner_spawns[index];
                out.push(Vec2::new(p.x, p.y));
            }
            return out;
        }
    }
    let centre = Vec2::new(f64::from(map.w) * TILE / 2., f64::from(map.h) * TILE / 2.);
    let mut used = vec![false; (map.w * map.h) as usize];
    let mut pf = Pathfinder::default();
    let mut path = Vec::new();
    for i in 0..n {
        let angle = (2. * math::PI * i as f64) / n.max(1) as f64;
        let want = Vec2::new(
            centre.x + math::cos(angle) * RING_RADIUS,
            centre.y + math::sin(angle) * RING_RADIUS,
        );
        let (tx0, ty0) = (
            math::floor_i64(want.x / TILE),
            math::floor_i64(want.y / TILE),
        );
        let mut chosen = None;
        for r in 0..=SPOT_SEARCH_TILES {
            let mut best = None;
            let mut dist = f64::INFINITY;
            for ty in ty0 - r..=ty0 + r {
                for tx in tx0 - r..=tx0 + r {
                    if (tx - tx0).abs().max((ty - ty0).abs()) != r
                        || tx < 0
                        || ty < 0
                        || tx >= map.w as i64
                        || ty >= map.h as i64
                    {
                        continue;
                    }
                    let key = (ty * map.w as i64 + tx) as usize;
                    if used[key] {
                        continue;
                    }
                    let at = Vec2::new((tx as f64 + 0.5) * TILE, (ty as f64 + 0.5) * TILE);
                    if !geometry::circle_clear(map, at, PLAYER_RADIUS, MASK_MOVE) {
                        continue;
                    }
                    let d = math::hypot(at.x - want.x, at.y - want.y);
                    if d >= dist {
                        continue;
                    }
                    if let Some(&origin) = arena.spawns.first() {
                        if origin != at {
                            pf.find_path_into(map, origin, at, PLAYER_RADIUS, &mut path);
                            if path.is_empty() {
                                continue;
                            }
                        }
                    }
                    best = Some((key, at));
                    dist = d;
                }
            }
            if let Some((key, at)) = best {
                used[key] = true;
                chosen = Some(at);
                break;
            }
        }
        out.push(chosen.unwrap_or_else(|| arena.spawns[i % arena.spawns.len()]));
    }
    out
}
pub(crate) fn settle(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    fx: &mut crate::fx_report::TickFx,
    stats: crate::status_runtime::stats::Inputs,
    deaths: usize,
    alive: usize,
) {
    let Some(rules) = k.config.lifecycle.rules() else {
        return;
    };
    if deaths > 0 {
        if let Some(schedule) = rules.schedule() {
            if w.rt.gates_locked {
                w.rt.patience_ends_at = super::arena_rules::slot_at(
                    w.raid_started_at,
                    w.server_time + schedule.min_gap_seconds * 1000.,
                    schedule,
                );
            }
        } else {
            w.rt.patience_ends_at = Some(
                w.server_time
                    + super::arena_rules::patience_seconds(
                        alive,
                        rules.patience_seconds,
                        rules.patience_min_seconds,
                    ) * 1000.,
            );
        }
        if w.rt.gates_locked {
            w.rt.in_coliseum = false;
        }
        w.rt.gates_locked = false;
        w.rt.sudden_death_at = 0.;
        return;
    }
    if !w.rt.gates_locked
        && w.rt
            .patience_ends_at
            .is_some_and(|end| w.server_time >= end)
    {
        teleport(k, w, ev, fx, stats);
    }
}
pub(crate) fn teleport(
    k: &MatchStatic,
    w: &mut World,
    ev: &mut Vec<Event>,
    fx: &mut crate::fx_report::TickFx,
    stats: crate::status_runtime::stats::Inputs,
) {
    let mut positions = spots(&k.arena, w.players.iter().filter(|p| p.standing()).count());
    for i in (1..positions.len()).rev() {
        let j = (w.spawn_rng.next_f64() * (i + 1) as f64) as usize;
        positions.swap(i, j);
    }
    let now = w.server_time;
    for (p, at) in w.players.iter_mut().filter(|p| p.standing()).zip(positions) {
        p.body.x = at.x;
        p.body.y = at.y;
        p.vitals.immune_until = now + IMMUNITY_MS;
        p.motion.path.clear();
        p.inputs.clear();
        p.body.history.reset(Sample {
            t: now,
            x: at.x,
            y: at.y,
        });
    }
    w.rt.gates_locked = true;
    w.rt.in_coliseum = true;
    w.rt.patience_ends_at = None;
    w.rt.sudden_death_at = now + k.config.lifecycle.rules().unwrap().sudden_death_seconds * 1000.;
    hooks::fire(
        &mut Hx {
            k,
            w,
            ev,
            stats,
            fx: Some(fx),
        },
        HookArgs::Teleported,
    );
    ev.push(Event::Teleported);
}
