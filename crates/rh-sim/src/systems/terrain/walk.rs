//! Exact shared/walk.ts traction, integration, swept disc contact, gates and livelock recovery.
pub(crate) use crate::constants::TERRAIN_ARRIVE_EPS as ARRIVE_EPS;
pub(crate) use crate::constants::TERRAIN_EPS as EPS;
pub(crate) use crate::constants::TERRAIN_GRIP_MS as GRIP_MS;
pub(crate) use crate::constants::TERRAIN_REACH as REACH;
pub(crate) use crate::constants::TERRAIN_REPLAN_MS as REPLAN_MS;
pub(crate) use crate::constants::TERRAIN_STUCK_REPLANS as STUCK_REPLANS;
pub(crate) use crate::constants::TERRAIN_STUCK_WINDOW_MS as STUCK_WINDOW_MS;
pub(crate) use crate::constants::TERRAIN_V_EPS as V_EPS;
use crate::{
    constants::{TICK_MS, TILE},
    fighter::SlipState,
    geometry::Footprint,
    map::MASK_MOVE,
    pathfind::Pathfinder,
    state::Path,
    TileMap, Vec2,
};
pub(crate) fn visit_content(mut word: impl FnMut(u64)) {
    for v in [
        REACH,
        REPLAN_MS,
        STUCK_REPLANS,
        STUCK_WINDOW_MS,
        GRIP_MS,
        ARRIVE_EPS,
        EPS,
        V_EPS,
    ] {
        word(v.to_bits());
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize)]
pub(crate) struct Result {
    pub hit: bool,
    pub reached: usize,
    pub moved: f64,
}
pub(crate) fn new_slip(p: Vec2, v: Vec2) -> SlipState {
    SlipState {
        vx: v.x,
        vy: v.y,
        ax: p.x,
        ay: p.y,
        path: None,
        replan_at: None,
        stuck_x: None,
        stuck_y: None,
        stuck_n: None,
        stuck_best: None,
        stuck_at: None,
        grip_until: None,
    }
}
/// X or Y source sweep of the mover's footprint; argument/lookup transposition is the only axis difference. A disc is the
/// legacy swept-disc contact exactly; a foot box (ADR0024) stops its leading face on the first solid tile face it would
/// cross in a row that openly overlaps the box.
pub(crate) fn sweep(map: &TileMap, x: f64, y: f64, delta: f64, foot: Footprint, swap: bool) -> f64 {
    match foot {
        Footprint::Disc(r) => sweep_disc(map, x, y, delta, r, swap),
        Footprint::Box { hx, hy } => {
            let (along, across) = if swap { (hy, hx) } else { (hx, hy) };
            sweep_box(map, x, y, delta, along, across, swap)
        }
    }
}
fn sweep_box(
    map: &TileMap,
    x: f64,
    y: f64,
    delta: f64,
    along: f64,
    across: f64,
    swap: bool,
) -> f64 {
    if delta == 0. {
        return x;
    }
    let nx = x + delta;
    // Rows that overlap the open interval (y - across, y + across): touching a row's edge is not contact.
    let j0 = ((y - across) / TILE).floor() as i64;
    let j1 = ((y + across) / TILE).ceil() as i64 - 1;
    let mut best = nx;
    let (i0, i1) = if delta > 0. {
        (
            (x / TILE).floor() as i64,
            ((nx + along) / TILE).floor() as i64,
        )
    } else {
        (
            ((nx - along) / TILE).floor() as i64,
            (x / TILE).floor() as i64,
        )
    };
    for i in i0..=i1 {
        let face = if delta > 0. {
            i as f64 * TILE
        } else {
            (i + 1) as f64 * TILE
        };
        if (delta > 0. && face < x - EPS) || (delta < 0. && face > x + EPS) {
            continue;
        }
        for j in j0..=j1 {
            if !(if swap {
                map.is_solid(j, i)
            } else {
                map.is_solid(i, j)
            }) {
                continue;
            }
            if delta > 0. {
                best = best.min(face - along);
            } else {
                best = best.max(face + along);
            }
        }
    }
    if delta > 0. {
        x.max(best)
    } else {
        x.min(best)
    }
}
fn sweep_disc(map: &TileMap, x: f64, y: f64, delta: f64, r: f64, swap: bool) -> f64 {
    if delta == 0. {
        return x;
    }
    let nx = x + delta;
    let j0 = ((y - r) / TILE).floor() as i64;
    let j1 = ((y + r) / TILE).floor() as i64;
    let mut best = nx;
    let (i0, i1) = if delta > 0. {
        ((x / TILE).floor() as i64, ((nx + r) / TILE).floor() as i64)
    } else {
        (((nx - r) / TILE).floor() as i64, (x / TILE).floor() as i64)
    };
    for i in i0..=i1 {
        let face = if delta > 0. {
            i as f64 * TILE
        } else {
            (i + 1) as f64 * TILE
        };
        if (delta > 0. && face < x - EPS) || (delta < 0. && face > x + EPS) {
            continue;
        }
        for j in j0..=j1 {
            if !(if swap {
                map.is_solid(j, i)
            } else {
                map.is_solid(i, j)
            }) {
                continue;
            }
            let gy = 0f64.max(j as f64 * TILE - y).max(y - (j + 1) as f64 * TILE);
            if gy >= r {
                continue;
            }
            let dr = (r * r - gy * gy).sqrt();
            let c = if delta > 0. { face - dr } else { face + dr };
            if delta > 0. {
                if c < best {
                    best = c;
                }
            } else if c > best {
                best = c;
            }
        }
    }
    if delta > 0. {
        x.max(best)
    } else {
        x.min(best)
    }
}
fn move_disc(
    map: &TileMap,
    p: &mut Vec2,
    s: &mut SlipState,
    mx: f64,
    my: f64,
    r: Footprint,
) -> bool {
    let mut hit = false;
    let nx = sweep(map, p.x, p.y, mx, r, false);
    if (nx - (p.x + mx)).abs() > EPS {
        s.vx = 0.;
        hit = true;
    }
    p.x = nx;
    let ny = sweep(map, p.y, p.x, my, r, true);
    if (ny - (p.y + my)).abs() > EPS {
        s.vy = 0.;
        hit = true;
    }
    p.y = ny;
    hit
}
#[allow(clippy::too_many_arguments)]
pub(crate) fn step(
    map: &TileMap,
    p: &mut Vec2,
    s: &mut SlipState,
    path: &mut Path,
    dt: f64,
    cap: f64,
    accel: f64,
    r: Footprint,
) -> Result {
    let mut res = Result::default();
    if s.path != Some(path.generation) {
        s.ax = p.x;
        s.ay = p.y;
        s.path = Some(path.generation);
    }
    if !(cap > 0.) {
        s.vx = 0.;
        s.vy = 0.;
        return res;
    }
    while path.len() > 1 {
        let w = path.first().unwrap();
        let gx = w.x - s.ax;
        let gy = w.y - s.ay;
        let px = p.x - w.x;
        let py = p.y - w.y;
        if px * gx + py * gy >= 0. || px * px + py * py <= REACH * REACH {
            s.ax = w.x;
            s.ay = w.y;
            path.advance();
            res.reached += 1;
        } else {
            break;
        }
    }
    let (mut dvx, mut dvy, mut d) = (0., 0., 0.);
    if let Some(w) = path.first() {
        let dx = w.x - p.x;
        let dy = w.y - p.y;
        d = (dx * dx + dy * dy).sqrt();
        if d > EPS {
            let mut sp = cap;
            if path.len() == 1 {
                let brake = accel * ((dt * dt + (2. * d) / accel).sqrt() - dt);
                if brake < sp {
                    sp = brake;
                }
            }
            dvx = (dx / d) * sp;
            dvy = (dy / d) * sp;
        }
    }
    let ex = dvx - s.vx;
    let ey = dvy - s.vy;
    let e = (ex * ex + ey * ey).sqrt();
    let lim = accel * dt;
    let (mx, my, nvx, nvy) = if e <= lim {
        let t1 = if e > 0. { e / accel } else { 0. };
        (
            ((s.vx + dvx) / 2.) * t1 + dvx * (dt - t1),
            ((s.vy + dvy) / 2.) * t1 + dvy * (dt - t1),
            dvx,
            dvy,
        )
    } else {
        let nvx = s.vx + (ex / e) * lim;
        let nvy = s.vy + (ey / e) * lim;
        (((s.vx + nvx) / 2.) * dt, ((s.vy + nvy) / 2.) * dt, nvx, nvy)
    };
    let (x0, y0) = (p.x, p.y);
    if path.len() == 1 {
        let m = (mx * mx + my * my).sqrt();
        let sp = (nvx * nvx + nvy * nvy).sqrt();
        if m >= d - ARRIVE_EPS && sp <= lim + V_EPS {
            let w = path.first().unwrap();
            s.vx = 0.;
            s.vy = 0.;
            res.hit = move_disc(map, p, s, w.x - p.x, w.y - p.y, r);
            s.vx = 0.;
            s.vy = 0.;
            path.advance();
            res.reached += 1;
            let ax = p.x - x0;
            let ay = p.y - y0;
            res.moved = (ax * ax + ay * ay).sqrt();
            return res;
        }
    }
    s.vx = nvx;
    s.vy = nvy;
    res.hit = move_disc(map, p, s, mx, my, r);
    if path.is_empty() && s.vx * s.vx + s.vy * s.vy < V_EPS {
        s.vx = 0.;
        s.vy = 0.;
    }
    let bx = p.x - x0;
    let by = p.y - y0;
    res.moved = (bx * bx + by * by).sqrt();
    res
}
fn clear(map: &TileMap, p: Vec2, target: Vec2, r: Footprint) -> bool {
    r.segment_clear(map, p, target, MASK_MOVE)
}
fn replan(
    pf: &mut Pathfinder,
    map: &TileMap,
    p: Vec2,
    path: &mut Path,
    s: &mut SlipState,
    r: Footprint,
) {
    let goal = *path.as_slice().last().unwrap();
    path.replan_in_place(pf, map, p, goal, r);
    s.ax = p.x;
    s.ay = p.y;
}
fn note_stuck(s: &mut SlipState, p: Vec2, goal: Vec2, now: f64) {
    let gx = goal.x - p.x;
    let gy = goal.y - p.y;
    let d = (gx * gx + gy * gy).sqrt();
    let again = s.stuck_x == Some(goal.x)
        && s.stuck_y == Some(goal.y)
        && s.stuck_at.is_some_and(|t| now - t <= STUCK_WINDOW_MS);
    let best = s.stuck_best.unwrap_or(d);
    s.stuck_at = Some(now);
    if again && d >= best - TILE {
        s.stuck_n = Some(s.stuck_n.unwrap_or(0.) + 1.);
        if d < best {
            s.stuck_best = Some(d);
        }
    } else {
        s.stuck_x = Some(goal.x);
        s.stuck_y = Some(goal.y);
        s.stuck_n = Some(1.);
        s.stuck_best = Some(d);
    }
    if s.stuck_n.unwrap() >= STUCK_REPLANS {
        s.grip_until = Some(now + GRIP_MS);
        s.stuck_n = Some(0.);
    }
}
#[allow(clippy::too_many_arguments)]
fn grip_step(
    map: &TileMap,
    p: &mut Vec2,
    s: &mut SlipState,
    path: &mut Path,
    dt: f64,
    cap: f64,
    r: Footprint,
    out: &mut Result,
    pf: &mut Pathfinder,
) {
    if s.path != Some(path.generation) {
        s.ax = p.x;
        s.ay = p.y;
        s.path = Some(path.generation);
        if path.first().is_some_and(|w| !clear(map, *p, w, r)) {
            replan(pf, map, *p, path, s, r);
        }
    }
    let (x0, y0) = (p.x, p.y);
    let mut budget = if cap > 0. { cap * dt } else { 0. };
    while budget > 0. && !path.is_empty() {
        let w = path.first().unwrap();
        let dx = w.x - p.x;
        let dy = w.y - p.y;
        let d = (dx * dx + dy * dy).sqrt();
        if d <= budget {
            p.x = w.x;
            p.y = w.y;
            budget -= d;
            s.ax = w.x;
            s.ay = w.y;
            path.advance();
            out.reached += 1;
        } else {
            p.x += (dx / d) * budget;
            p.y += (dy / d) * budget;
            budget = 0.;
        }
    }
    let mx = p.x - x0;
    let my = p.y - y0;
    s.vx = mx / dt;
    s.vy = my / dt;
    out.moved += (mx * mx + my * my).sqrt();
}
#[allow(clippy::too_many_arguments)]
pub(crate) fn walk(
    map: &TileMap,
    p: &mut Vec2,
    s: &mut SlipState,
    path: &mut Path,
    dt_ms: f64,
    cap: f64,
    slip_at: impl Fn(f64, f64) -> f64,
    now: f64,
    r: Footprint,
    pf: &mut Pathfinder,
) -> Result {
    let mut out = Result::default();
    if s.grip_until.is_some_and(|t| t > now + GRIP_MS) {
        s.grip_until = Some(now + GRIP_MS);
    }
    let mut left = dt_ms;
    while left > EPS {
        let accel = slip_at(p.x, p.y);
        if !(accel > 0.) {
            break;
        }
        let h = left.min(TICK_MS);
        left -= h;
        if s.grip_until.is_some_and(|t| now < t) {
            grip_step(map, p, s, path, h / 1000., cap, r, &mut out, pf);
            continue;
        }
        let st = step(map, p, s, path, h / 1000., cap, accel, r);
        out.moved += st.moved;
        out.reached += st.reached;
        out.hit |= st.hit;
        if st.hit
            && !path.is_empty()
            && s.replan_at.is_none_or(|t| now >= t)
            && !clear(map, *p, path.first().unwrap(), r)
        {
            s.replan_at = Some(now + REPLAN_MS);
            note_stuck(s, *p, *path.as_slice().last().unwrap(), now);
            replan(pf, map, *p, path, s, r);
        }
    }
    out
}
pub(crate) fn regrip(
    map: &TileMap,
    p: Vec2,
    path: &mut Path,
    pf: &mut Pathfinder,
    foot: Footprint,
) {
    if path.first().is_some_and(|w| !clear(map, p, w, foot)) {
        let goal = *path.as_slice().last().unwrap();
        path.replan(pf, map, p, goal, foot);
    }
}
#[cfg(test)]
mod box_sweep_tests {
    use super::*;

    /// ADR0024: on ice the foot box's leading face stops on a wall face (the disc stops its centre `r` away).
    #[test]
    fn a_foot_box_sweep_stops_its_leading_face_on_the_wall() {
        let map = crate::arenas::practice_arena().map;
        let (w, h) = (map.w as i64, map.h as i64);
        let (tx, ty) = (1..h - 1)
            .flat_map(|ty| (1..w - 1).map(move |tx| (tx, ty)))
            .find(|&(tx, ty)| {
                map.is_solid(tx + 1, ty)
                    && !map.is_solid(tx, ty)
                    && !map.is_solid(tx, ty - 1)
                    && !map.is_solid(tx, ty + 1)
                    && !map.is_solid(tx - 1, ty)
            })
            .expect("a floor tile with a wall to its east");
        let face = (tx + 1) as f64 * TILE;
        let y = ty as f64 * TILE + TILE / 2.0;
        let x = tx as f64 * TILE + 4.0;
        let foot = Footprint::Box { hx: 10.0, hy: 6.0 };
        assert_eq!(sweep(&map, x, y, 100.0, foot, false), face - 10.0);
        assert_eq!(sweep(&map, x, y, 5.0, foot, false), x + 5.0);
        let disc = sweep(&map, x, y, 100.0, Footprint::Disc(12.0), false);
        assert_eq!(disc, face - 12.0);
        // Moving north-south along x, the box's half-height leads instead (swap transposes the axes).
        let ny = sweep(&map, y, x, 0.0, foot, true);
        assert_eq!(ny, y);
    }
}
