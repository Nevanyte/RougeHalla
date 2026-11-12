//! Fire: the volcano (P-MAPGEN-SIG-FIRE-1; no legacy counterpart, DEV-020). A cone of wall with a lava crater on the
//! Fire zone's back edge (its centre farther from the map centre than the zone's centroid), and two or three lava
//! streams (`LavaStream`, LOW lava, two tiles wide) that run from it toward the front, each ending in a lava pool
//! (`LavaPool`), edged with ember floor owned by the stream or pool. The shape is the server post-pass's `volcano`
//! (`crates/rh-server/src/signature.rs` before this packet), with the streams fanned within the front half instead of
//! evenly round the cone.
//!
//! Site: a uniform draw among the back-edge centres whose cone fits, taking first the centres farthest from every Fire
//! camp (`Definition::camp_room` tiers, so the camps' craters keep out of the core band). A stream is laid as a line
//! through free ground (the zone's floor outside the legacy landmark protection, camp halos and every apron marked so
//! far); where the line is blocked it bends by one direction step at a time, within `stream_bend` of its own heading
//! and `front_max` of the front, or stops and ends in its pool early. A site with fewer than two streams, lava outside
//! `lava_budget`, or a split of the zone's floor is not used. Integer geometry: directions are `DIR16` vectors (length
//! 1024) and positions are fixed point (1/1024 tile).
use super::{at, front, pick, Built, Piece, Site};
use crate::map::{TILE_FLOOR, TILE_LOW, TILE_WALL};
use crate::mapdata::{FeatureJob, FeatureKind, TilePt, Zone, ZoneAnchor};
use crate::mapgen::coliseum::{CX, CY, H, W};
use crate::mapgen::zones::camps::CampSite;
use crate::rng::Mulberry32;

use super::super::recipe_support::DIR16;

/// The volcano with its streams and pools for the Fire zone, or `None` when the zone has no legal site (the attempt is
/// refused, G5).
pub(super) fn place(s: &Site<'_>, camps: &[CampSite], rng: &mut Mulberry32) -> Option<Built> {
    let d = &s.ctx.rules;
    let from_centre = |x: f64, y: f64| {
        let (dx, dy) = (x - W as f64 / 2.0, y - H as f64 / 2.0);
        crate::math::sqrt(dx * dx + dy * dy)
    };
    let (mut sx, mut sy, mut n) = (0i64, 0i64, 0i64);
    for i in (0..W * H).filter(|&i| s.zone[i] == s.slot) {
        sx += 2 * (i % W) as i64 + 1;
        sy += 2 * (i / W) as i64 + 1;
        n += 1;
    }
    if n == 0 {
        return None;
    }
    let need = from_centre(sx as f64 / (2 * n) as f64, sy as f64 / (2 * n) as f64) + d.back_slack;
    let half = (1..).find(|r: &i32| r * r > d.cone_d2).unwrap() - 1;
    let cone: Vec<(i32, i32)> = (-half..=half)
        .flat_map(|dy| (-half..=half).map(move |dx| (dx, dy)))
        .filter(|&(dx, dy)| dx * dx + dy * dy <= d.cone_d2)
        .collect();
    let mine: Vec<(i32, i32)> = camps
        .iter()
        .filter(|c| c.zone == s.slot)
        .map(|c| ((c.site % W) as i32, (c.site / W) as i32))
        .collect();
    let apron = half + d.bands[0];
    let mut tiers: Vec<Vec<(i32, i32)>> = vec![Vec::new(); d.camp_room.len()];
    for i in (0..W * H).filter(|&i| s.zone[i] == s.slot) {
        let (x, y) = ((i % W) as i32, (i / W) as i32);
        if from_centre(f64::from(x) + 0.5, f64::from(y) + 0.5) <= need
            || at(x - apron, y - apron).is_none()
            || at(x + apron, y + apron).is_none()
            || !cone
                .iter()
                .all(|&(dx, dy)| s.wall(x + dx, y + dy) && s.ground(x + dx, y + dy))
        {
            continue;
        }
        let room = mine
            .iter()
            .map(|&(cx, cy)| (cx - x).abs().max((cy - y).abs()) - half)
            .min()
            .unwrap_or(i32::MAX);
        if let Some(t) = d.camp_room.iter().position(|&r| room >= r) {
            tiers[t].push((x, y));
        }
    }
    let before = s.floor_pieces(&[]);
    for mut sites in tiers {
        for _ in 0..d.site_tries {
            if sites.is_empty() {
                break;
            }
            let (x, y) = sites.remove(pick(rng, sites.len()));
            if let Some(built) = build(s, x, y, &cone, before, rng) {
                return Some(built);
            }
        }
    }
    None
}

/// One stream with its pool: the stream's lava tiles (first the path's first tile), the pool's lava tiles, and the
/// pool's centre tile.
type Body = (Vec<usize>, Vec<usize>, (i32, i32));

/// One site: the cone at (x, y) and its streams, or `None` when fewer than two streams fit, the lava leaves the budget
/// or the zone's floor would split.
fn build(
    s: &Site<'_>,
    x: i32,
    y: i32,
    cone: &[(i32, i32)],
    before: usize,
    rng: &mut Mulberry32,
) -> Option<Built> {
    let d = &s.ctx.rules;
    // Cell marks while the site is built: 1 the cone, 2 lava.
    let mut mark = vec![0u8; W * H];
    for &(dx, dy) in cone {
        mark[at(x + dx, y + dy)?] = 1;
    }
    let count = d.streams.0 + pick(rng, d.streams.1 - d.streams.0 + 1);
    let spreads = d.spreads[count - d.streams.0];
    let spread = spreads[pick(rng, spreads.len())];
    let (lo, hi) = d.stream_len[count - d.streams.0];
    let f = i32::from(front(x, y));
    let mut bodies: Vec<Body> = Vec::new();
    for &o in spread {
        let len = lo + pick(rng, (hi - lo + 1) as usize) as i32;
        let Some(body) = stream(s, &mark, cone, (x, y), f, (f + o).rem_euclid(16), len) else {
            continue;
        };
        for &i in body.0.iter().chain(&body.1) {
            mark[i] = 2;
        }
        bodies.push(body);
    }
    let crater: Vec<(i32, i32)> = cone
        .iter()
        .copied()
        .filter(|&(dx, dy)| dx * dx + dy * dy <= d.crater_d2)
        .collect();
    let lava = crater.len() + bodies.iter().map(|b| b.0.len() + b.1.len()).sum::<usize>();
    if bodies.len() < d.streams.0 || lava < d.lava_budget.0 || lava > d.lava_budget.1 {
        return None;
    }
    let solid: Vec<usize> = (0..W * H).filter(|&i| mark[i] != 0).collect();
    if s.floor_pieces(&solid) > before {
        return None;
    }
    let cone_cells: Vec<(usize, u8, u8)> = cone
        .iter()
        .map(|&(dx, dy)| {
            let i = at(x + dx, y + dy).unwrap();
            if crater.contains(&(dx, dy)) {
                (i, TILE_LOW, d.lava)
            } else {
                (i, TILE_WALL, 0)
            }
        })
        .collect();
    let mut pieces = vec![Piece {
        kind: FeatureKind::Volcano,
        job: FeatureJob::Landmark,
        anchor: (x, y),
        cells: cone_cells,
    }];
    // Ember: the free ground round each body's lava, owned by the first body that reaches it.
    let mut ember = vec![false; W * H];
    for (stream_cells, pool_cells, pool_at) in bodies {
        let first = ((stream_cells[0] % W) as i32, (stream_cells[0] / W) as i32);
        for (kind, cells, anchor) in [
            (FeatureKind::LavaStream, stream_cells, first),
            (FeatureKind::LavaPool, pool_cells, pool_at),
        ] {
            let mut out: Vec<(usize, u8, u8)> =
                cells.iter().map(|&i| (i, TILE_LOW, d.lava)).collect();
            for &i in &cells {
                let (cx, cy) = ((i % W) as i32, (i / W) as i32);
                for (dx, dy) in (-1..=1).flat_map(|dy| (-1..=1).map(move |dx| (dx, dy))) {
                    let Some(j) = at(cx + dx, cy + dy).filter(|_| (dx, dy) != (0, 0)) else {
                        continue;
                    };
                    if mark[j] == 0 && !ember[j] && free(s, cx + dx, cy + dy) {
                        ember[j] = true;
                        out.push((j, TILE_FLOOR, d.ember));
                    }
                }
            }
            pieces.push(Piece {
                kind,
                job: FeatureJob::Crossing,
                anchor,
                cells: out,
            });
        }
    }
    Some(Built {
        anchor: ZoneAnchor {
            zone: Zone::Fire,
            kind: FeatureKind::Volcano,
            centre: TilePt { x, y },
            footprint: super::bounds(cone.iter().map(|&(dx, dy)| at(x + dx, y + dy).unwrap())),
            front: front(x, y),
            entrance: Vec::new(),
        },
        pieces,
    })
}

/// Ground a lava or ember tile may take: this zone's free floor outside the legacy protection, the camp halos and every
/// apron marked so far.
fn free(s: &Site<'_>, x: i32, y: i32) -> bool {
    s.ground(x, y) && s.halo[at(x, y).unwrap()] == 0
}

/// The side cell that makes a stream of heading `h` two tiles wide: the 4-neighbour across its dominant axis.
fn side(h: i32) -> (i32, i32) {
    let v = DIR16[h as usize];
    if v[0].abs() >= v[1].abs() {
        (0, 1)
    } else {
        (1, 0)
    }
}

/// The cyclic distance between two DIR16 indices.
fn turn(a: i32, b: i32) -> i32 {
    let t = (a - b).rem_euclid(16);
    t.min(16 - t)
}

/// One stream from the cone at `c` with heading `h0` and target `len` path tiles, and its pool: (stream lava, pool lava,
/// pool centre), or `None` when no stream of at least `stream_min` tiles with a pool fits.
fn stream(
    s: &Site<'_>,
    mark: &[u8],
    cone: &[(i32, i32)],
    c: (i32, i32),
    f: i32,
    h0: i32,
    len: i32,
) -> Option<Body> {
    let d = &s.ctx.rules;
    // DIR16 vectors have length 1024: positions are fixed point, 1/1024 tile.
    let one = 1024;
    let tile = |p: (i32, i32)| (p.0.div_euclid(one), p.1.div_euclid(one));
    let step = |p: (i32, i32), h: i32| {
        let v = DIR16[h.rem_euclid(16) as usize];
        (p.0 + v[0], p.1 + v[1])
    };
    let (ox, oy) = (c.0 * one + one / 2, c.1 * one + one / 2);
    // A lava tile: free ground off the cone, and `stream_gap` from every other body (except beside the cone).
    let lava_ok = |t: (i32, i32)| -> bool {
        let Some(i) = at(t.0, t.1) else {
            return false;
        };
        if mark[i] != 0 || !free(s, t.0, t.1) {
            return false;
        }
        let (dx, dy) = (t.0 - c.0, t.1 - c.1);
        if dx * dx + dy * dy <= d.start_d2 {
            return true;
        }
        let g = d.stream_gap;
        (-g..=g).all(|ny| (-g..=g).all(|nx| at(t.0 + nx, t.1 + ny).is_none_or(|j| mark[j] != 2)))
    };
    // A path tile and its side cell, which is across the heading the path entered that tile with.
    let pair = |t: (i32, i32), h: i32| {
        let sd = side(h);
        [t, (t.0 + sd.0, t.1 + sd.1)]
    };
    let wide = |t: (i32, i32), h: i32| pair(t, h).iter().all(|&q| lava_ok(q));
    let v = DIR16[h0 as usize];
    let mut pos = (ox + d.stream_start * v[0], oy + d.stream_start * v[1]);
    let first = tile(pos);
    if !wide(first, h0) {
        return None;
    }
    // (position, heading, tile) per path tile.
    let mut path = vec![(pos, h0, first)];
    let mut h = h0;
    'grow: while (path.len() as i32) < len {
        for k in [0, 1, -1, 2, -2] {
            let toward = if turn(h + 1, f) <= turn(h - 1, f) {
                1
            } else {
                -1
            };
            let hn = (h + k * toward).rem_euclid(16);
            if turn(hn, h0) > d.stream_bend || turn(hn, f) > d.front_max {
                continue;
            }
            let next = step(pos, hn);
            let t = tile(next);
            let last = path.last().unwrap().2;
            if t == last {
                pos = next;
                continue 'grow;
            }
            if path.iter().any(|p| pair(p.2, p.1).contains(&t)) {
                continue;
            }
            if wide(t, hn) {
                pos = next;
                h = hn;
                path.push((pos, h, t));
                continue 'grow;
            }
        }
        break;
    }
    while path.len() >= d.stream_min {
        let &(p, hp, _) = path.last().unwrap();
        let mut cells: Vec<usize> = Vec::new();
        for &(_, ht, t) in &path {
            for q in pair(t, ht) {
                let i = at(q.0, q.1).unwrap();
                if !cells.contains(&i) {
                    cells.push(i);
                }
            }
        }
        // Where the heading changes the pairs can leave a neck: fill it, or end the stream a tile sooner.
        if !widen(&mut cells, &lava_ok) {
            path.pop();
            continue;
        }
        let pc = tile(step(step(p, hp), hp));
        for &r2 in d.pool_d2 {
            if let Some(pool) = pool(&cells, pc, r2, &lava_ok) {
                if ends_well(&cells, &pool, cone, c) {
                    return Some((cells, pool, pc));
                }
            }
        }
        path.pop();
    }
    None
}

/// The first tile of `cells` that keeps the stream from being two tiles wide, with the reason: `Some(axis)` for a neck
/// (its run of stream tiles along `axis`, 0 = x, 1 = y, is 1 while the run along the other axis is 3 or more), `None`
/// for a tile in no 2x2 window holding 3 stream tiles.
fn first_thin(cells: &[usize]) -> Option<((i32, i32), Option<usize>)> {
    let has = |q: (i32, i32)| at(q.0, q.1).is_some_and(|i| cells.contains(&i));
    let run = |c: (i32, i32), d: (i32, i32)| {
        let mut n = 1;
        for s in [1, -1] {
            let mut p = (c.0 + s * d.0, c.1 + s * d.1);
            while has(p) {
                n += 1;
                p = (p.0 + s * d.0, p.1 + s * d.1);
            }
        }
        n
    };
    cells.iter().find_map(|&i| {
        let c = ((i % W) as i32, (i / W) as i32);
        let (rx, ry) = (run(c, (1, 0)), run(c, (0, 1)));
        if rx.min(ry) == 1 && rx.max(ry) >= 3 {
            return Some((c, Some(usize::from(rx != 1))));
        }
        let window = window_offsets().iter().any(|&(ox, oy)| {
            window_tiles()
                .iter()
                .filter(|&&(dx, dy)| has((c.0 + ox + dx, c.1 + oy + dy)))
                .count()
                >= 3
        });
        (!window).then_some((c, None))
    })
}

/// The offsets of the four 2x2 windows holding a tile (geometry, not a tunable: no content entry).
fn window_offsets() -> [(i32, i32); 4] {
    [(0, 0), (-1, 0), (0, -1), (-1, -1)]
}

/// The tiles of a 2x2 window from its offset.
fn window_tiles() -> [(i32, i32); 4] {
    [(0, 0), (1, 0), (0, 1), (1, 1)]
}

/// Make the stream two tiles wide (`first_thin` finds nothing) by adding lava tiles `ok` allows: beside a neck, on the
/// side its diagonal neighbours already favour; beside a lone tile, the missing tile of its fullest 2x2 window. `false`
/// when a thin tile has no allowed fill (or the fills run past the stream's own length).
fn widen(cells: &mut Vec<usize>, ok: &impl Fn((i32, i32)) -> bool) -> bool {
    let limit = 2 * cells.len();
    for _ in 0..=limit {
        let Some((c, neck)) = first_thin(cells) else {
            return true;
        };
        let has = |q: (i32, i32)| at(q.0, q.1).is_some_and(|i| cells.contains(&i));
        let mut fills: Vec<(i32, i32)> = Vec::new();
        match neck {
            // A neck along `axis`: fill across it, on the side with more stream tiles diagonally beside it.
            Some(axis) => {
                let across = |s: i32| if axis == 0 { (s, 0) } else { (0, s) };
                let along = |s: i32| if axis == 0 { (0, s) } else { (s, 0) };
                let support = |s: i32| {
                    [-1, 1]
                        .iter()
                        .filter(|&&a| {
                            let (o, l) = (across(s), along(a));
                            has((c.0 + o.0 + l.0, c.1 + o.1 + l.1))
                        })
                        .count()
                };
                let sides = if support(-1) > support(1) {
                    [-1, 1]
                } else {
                    [1, -1]
                };
                fills.extend(
                    sides
                        .iter()
                        .map(|&s| (c.0 + across(s).0, c.1 + across(s).1)),
                );
            }
            // No window with three: the missing tiles of the fullest windows first.
            None => {
                let mut windows: Vec<(usize, (i32, i32))> = window_offsets()
                    .iter()
                    .map(|&(ox, oy)| {
                        let n = window_tiles()
                            .iter()
                            .filter(|&&(dx, dy)| has((c.0 + ox + dx, c.1 + oy + dy)))
                            .count();
                        (n, (ox, oy))
                    })
                    .collect();
                // Stable: equally full windows keep the `window_offsets` order.
                windows.sort_by_key(|w| std::cmp::Reverse(w.0));
                for (_, (ox, oy)) in windows {
                    fills.extend(
                        window_tiles()
                            .iter()
                            .map(|&(dx, dy)| (c.0 + ox + dx, c.1 + oy + dy))
                            .filter(|&q| !has(q)),
                    );
                }
            }
        }
        let Some(q) = fills.into_iter().find(|&q| !has(q) && ok(q)) else {
            return false;
        };
        cells.push(at(q.0, q.1).unwrap());
    }
    false
}

/// The pool round `pc`: every tile within squared distance `r2` that is not the stream's, all free; at least
/// `piece_min` lava tiles with a 2x2 block.
fn pool(
    stream: &[usize],
    pc: (i32, i32),
    r2: i32,
    ok: &impl Fn((i32, i32)) -> bool,
) -> Option<Vec<usize>> {
    let r = (1..).find(|k: &i32| k * k > r2).unwrap() - 1;
    let mut out = Vec::new();
    for dy in -r..=r {
        for dx in -r..=r {
            if dx * dx + dy * dy > r2 {
                continue;
            }
            let t = (pc.0 + dx, pc.1 + dy);
            let i = at(t.0, t.1)?;
            if stream.contains(&i) {
                continue;
            }
            if !ok(t) {
                return None;
            }
            out.push(i);
        }
    }
    let has = |x: i32, y: i32| at(x, y).is_some_and(|i| out.contains(&i));
    let block = out.iter().any(|&i| {
        let (x, y) = ((i % W) as i32, (i / W) as i32);
        has(x + 1, y) && has(x, y + 1) && has(x + 1, y + 1)
    });
    (out.len() >= crate::mapgen::certify::rules::R.piece_min && block).then_some(out)
}

/// The stream's tiles nearest the volcano centre touch the cone, its farthest touch the pool, and its farthest is
/// nearer the coliseum than the centre (the oracle's start, end and front).
fn ends_well(stream: &[usize], pool: &[usize], cone: &[(i32, i32)], c: (i32, i32)) -> bool {
    let xy = |i: usize| ((i % W) as i32, (i / W) as i32);
    let d2 = |a: (i32, i32), b: (i32, i32)| (a.0 - b.0).pow(2) + (a.1 - b.1).pow(2);
    let near = stream.iter().map(|&i| d2(xy(i), c)).min().unwrap_or(0);
    let far = stream.iter().map(|&i| d2(xy(i), c)).max().unwrap_or(0);
    let col = (CX, CY);
    stream.iter().map(|&i| xy(i)).all(|t| {
        let dc = d2(t, c);
        (dc != near
            || cone
                .iter()
                .any(|&(dx, dy)| (c.0 + dx - t.0).abs().max((c.1 + dy - t.1).abs()) <= 1))
            && (dc != far
                || (pool.iter().any(|&p| {
                    let q = xy(p);
                    (q.0 - t.0).abs().max((q.1 - t.1).abs()) <= 1
                }) && d2(t, col) < d2(c, col)))
    })
}
