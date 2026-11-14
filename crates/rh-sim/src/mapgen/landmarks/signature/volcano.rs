//! Fire: the volcano's lava streams (P-MAPGEN-SIG-FIRE-1, P-MAPGEN-SIG-SCALE-4; no legacy counterpart, DEV-020). The
//! cone is the owner's drawing (`volcano.txt`), landed by the generic stamp from its table entry (`spec::specs`) in the
//! Fire site's inner rect. Its three lava streams (`LavaStream`, LOW lava, two tiles wide) are not drawn: `streams` lays
//! one from each outlet run of the landed drawing (the entrance tiles of its front row, in grid order: left, middle,
//! right), heading its run's `Definition::outlet_heading` turned with the drawing, each ending in a lava pool
//! (`LavaPool`), edged with ember floor owned by the stream or pool.
//!
//! A stream is laid as a line through free ground (`free`: the zone's floor outside the camp halos and every apron
//! marked so far, off the cone); where the line is blocked it bends by one direction step at a time,
//! within `stream_bend` of its own heading and `front_max` of the drawing's front, or ends sooner. Its length, measured
//! as the oracle measures it (`length`), lies in its run's `outlet_len` range, and the middle stream is strictly the
//! longest: it is laid first, and the side streams are held below it. An attempt whose three streams cannot all be laid
//! (a stream short of its range, no pool, a ford, the fan broken, two bodies touching, lava outside `lava_budget`, or a
//! split of the zone's floor) is refused: never two streams. Integer geometry: directions are `DIR16` vectors (length
//! 1024) and positions are fixed point (1/1024 tile).
use super::blueprint::{dir16, Blueprint, Cell, Landing};
use super::spec::Spec;
use super::{at, pick, Built, Owned, Piece, Site, TerrainCodes};
use crate::map::{TILE_FLOOR, TILE_LOW};
use crate::mapdata::{FeatureJob, FeatureKind};
use crate::mapgen::coliseum::{H, W};
use crate::rng::Mulberry32;

use super::super::recipe_support::DIR16;

/// One stream with its pool: the stream's lava tiles (first the path's first tile), the pool's lava tiles, the pool's
/// centre tile, and the stream's length (`length`).
struct Body {
    lava: Vec<usize>,
    pool: Vec<usize>,
    centre: Cell,
    len: i32,
}

/// What one stream is laid from: its outlet run's map tiles, the drawing's front (map axis and its DIR16 index), the
/// stream's heading (DIR16), and its length window (path tiles, inclusive; the upper end is the drawn target).
struct Lay {
    run: Vec<Cell>,
    u: Cell,
    f: i32,
    h0: i32,
    lo: i32,
    target: i32,
}

/// P-MAPGEN-SIG-SCALE-4: the volcano's three streams with their pools, laid from the outlet runs of the drawing `bp`
/// stamped at `landing` (entry `spec`), appended to `built` after the cone in grid order (stream, then pool, per run);
/// `None` refuses the attempt. Draws: one length per run, in grid order (left, middle, right as drawn, whatever the
/// mirror makes of them on the map), from its `outlet_len` range, before anything can refuse; nothing else draws. The
/// middle run is laid first, up to its drawn length; each side run then up to its own, held below the middle's
/// measured length. Then: no stream or pool touches another's lava, each stream touches its own run only, the pools
/// fan out (in grid terms: beyond the front row; the left one left of its run, the right one right, the middle one
/// within 45 degrees of straight ahead; their columns ascending), the zone's lava lies in `lava_budget`, and the cone
/// with every stream and pool does not split the zone's floor. `s` must be unconfined (`Site::inner` `None`): the
/// streams leave the site.
pub(super) fn streams(
    s: &Site<'_>,
    rng: &mut Mulberry32,
    bp: &Blueprint,
    spec: &Spec,
    landing: &Landing,
    built: &mut Built,
) -> Option<()> {
    let d = &s.ctx.rules;
    let codes = &s.ctx.codes;
    let want: Vec<i32> = d
        .outlet_len
        .iter()
        .map(|&(lo, hi)| lo + pick(rng, (hi - lo + 1).max(1) as usize) as i32)
        .collect();
    // The outlet runs: the entrance tiles on the front row, ascending gx, split where gx skips.
    let front_row = bp.size().1 - 1;
    let mut runs: Vec<Vec<Cell>> = Vec::new();
    for g in bp
        .entrance(spec.entrance)
        .into_iter()
        .filter(|g| g.1 == front_row)
    {
        match runs.last_mut() {
            Some(r) if r.last().is_some_and(|p| p.0 + 1 == g.0) => r.push(g),
            _ => runs.push(vec![g]),
        }
    }
    if runs.len() != d.outlet_heading.len() {
        return None;
    }
    let landed: Vec<Vec<Cell>> = runs
        .iter()
        .map(|r| r.iter().map(|&g| landing.tile(g)).collect())
        .collect();
    let o = landing.orientation;
    let f = i32::from(dir16(o.front));
    // Cell marks while the streams are laid: 1 the cone, 2 a stream's or pool's lava.
    let mut mark = vec![0u8; W * H];
    let mut solid = Vec::new();
    let mut cone_lava = 0usize;
    for p in &built.pieces {
        for &(i, tile, _) in &p.cells {
            mark[i] = 1;
            solid.push(i);
            cone_lava += usize::from(tile == TILE_LOW);
        }
    }
    let before = s.floor_pieces(&[]);
    let main = runs.len() / 2;
    let mut bodies: Vec<Option<Body>> = (0..runs.len()).map(|_| None).collect();
    for k in std::iter::once(main).chain((0..runs.len()).filter(|&k| k != main)) {
        let (lo, mut hi) = d.outlet_len[k];
        if let Some(m) = bodies[main].as_ref().filter(|_| k != main) {
            hi = hi.min(m.len - 1);
        }
        let lay = Lay {
            run: landed[k].clone(),
            u: o.front,
            f,
            h0: i32::from(dir16(o.turn(d.outlet_heading[k]))),
            lo,
            target: want[k].min(hi),
        };
        let body = stream(s, &mark, &lay)?;
        for &i in body.lava.iter().chain(&body.pool) {
            mark[i] = 2;
        }
        bodies[k] = Some(body);
    }
    let bodies: Vec<Body> = bodies.into_iter().collect::<Option<_>>()?;
    let xy = |i: usize| ((i % W) as i32, (i / W) as i32);
    let touches = |a: &[usize], b: &[Cell]| {
        a.iter().any(|&i| {
            let p = xy(i);
            b.iter()
                .any(|q| (p.0 - q.0).abs().max((p.1 - q.1).abs()) <= 1)
        })
    };
    let all: Vec<Vec<usize>> = bodies
        .iter()
        .map(|b| [b.lava.clone(), b.pool.clone()].concat())
        .collect();
    for (a, body) in all.iter().enumerate() {
        let others = all
            .iter()
            .enumerate()
            .filter(|&(b, _)| b != a)
            .any(|(_, other)| touches(body, &other.iter().map(|&i| xy(i)).collect::<Vec<_>>()));
        let strays = landed
            .iter()
            .enumerate()
            .any(|(r, run)| r != a && touches(&bodies[a].lava, run));
        if others || strays {
            return None;
        }
    }
    // The fan, in grid terms (doubled, times the pool's size, to stay in integers): the pool's centroid against its
    // run's centre.
    let r = o.turn((1, 0));
    let grid = |i: usize| {
        let p = xy(i);
        let q = (p.0 - landing.origin.0, p.1 - landing.origin.1);
        (q.0 * r.0 + q.1 * r.1, q.0 * o.front.0 + q.1 * o.front.1)
    };
    let mut cols: Vec<(i64, i64)> = Vec::with_capacity(bodies.len());
    for (k, b) in bodies.iter().enumerate() {
        let n = b.pool.len() as i64;
        let (sx, sy) = b.pool.iter().fold((0i64, 0i64), |acc, &i| {
            let g = grid(i);
            (acc.0 + i64::from(g.0), acc.1 + i64::from(g.1))
        });
        let ends = i64::from(runs[k][0].0) + i64::from(runs[k][runs[k].len() - 1].0);
        let (dx, dy) = (2 * sx - n * ends, 2 * sy - 2 * n * i64::from(front_row));
        let side_ok = if k == 0 {
            dx < 0
        } else if k == bodies.len() - 1 {
            dx > 0
        } else {
            dx.abs() <= dy
        };
        if dy <= 0 || !side_ok {
            return None;
        }
        cols.push((sx, n));
    }
    if cols.windows(2).any(|w| w[0].0 * w[1].1 >= w[1].0 * w[0].1) {
        return None;
    }
    let lava = cone_lava + all.iter().map(Vec::len).sum::<usize>();
    if lava < d.lava_budget.0 || lava > d.lava_budget.1 {
        return None;
    }
    solid.extend(all.iter().flatten().copied());
    if s.floor_pieces(&solid) > before {
        return None;
    }
    // Ember: the free ground round each body's lava, owned by the first body that reaches it.
    let mut ember = vec![false; W * H];
    for b in bodies {
        let first = xy(b.lava[0]);
        for (kind, cells, anchor) in [
            (FeatureKind::LavaStream, b.lava, first),
            (FeatureKind::LavaPool, b.pool, b.centre),
        ] {
            let mut out: Vec<(usize, u8, u8)> =
                cells.iter().map(|&i| (i, TILE_LOW, codes.lava)).collect();
            for &i in &cells {
                let (cx, cy) = xy(i);
                for (dx, dy) in (-1..=1).flat_map(|dy| (-1..=1).map(move |dx| (dx, dy))) {
                    let Some(j) = at(cx + dx, cy + dy).filter(|_| (dx, dy) != (0, 0)) else {
                        continue;
                    };
                    if mark[j] == 0 && !ember[j] && free(s, cx + dx, cy + dy) {
                        ember[j] = true;
                        out.push((j, TILE_FLOOR, codes.ember));
                    }
                }
            }
            built.pieces.push(Piece {
                kind,
                job: FeatureJob::Crossing,
                anchor,
                cells: out,
            });
        }
    }
    Some(())
}

/// What `SignatureContext::intact` accepts on the tiles the volcano's streams and pools own (no drawing writes them;
/// the cone's own pairs come from its legend): a stream's or a pool's LOW lava or its ember floor.
pub(super) fn owned(codes: &TerrainCodes) -> Vec<(FeatureKind, Owned)> {
    let body = vec![
        (TILE_LOW, Some(codes.lava)),
        (TILE_FLOOR, Some(codes.ember)),
    ];
    vec![
        (FeatureKind::LavaStream, body.clone()),
        (FeatureKind::LavaPool, body),
    ]
}

/// Ground a lava or ember tile may take: this zone's free floor (`Site::floor`, unconfined) outside the camp halos and
/// every apron marked so far. Not the legacy landmark protection (`Site::ground` also asks for it: the camp clearings
/// grown by `landmark_clearing_margin`): the camps keep only their halos out of the reserved site, so that protection
/// reaches into the site's apron ring and covers the ground in front of the outlets, where the streams must start
/// (P-MAPGEN-SIG-SCALE-4, measured on seeds 1-64: with it, the middle stream is refused on nearly every attempt). The
/// halo, which the certifier asks for, still holds everywhere.
fn free(s: &Site<'_>, x: i32, y: i32) -> bool {
    s.floor(x, y) && {
        let i = at(x, y).unwrap();
        s.halo[i] == 0 && s.apron[i] == 0
    }
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

/// One stream from outlet run `lay.run` with heading `lay.h0`, and its pool, or `None` when no stream of `lay.lo` to
/// `lay.target` tiles (`length`) with a pool fits. The path is grown to two tiles past the target and shortened from
/// its end until its length fits. Its first tile lies `stream_start` steps beyond the run, placed so that its pair of
/// lava tiles continues the run's two outlets.
fn stream(s: &Site<'_>, mark: &[u8], lay: &Lay) -> Option<Body> {
    let d = &s.ctx.rules;
    let (f, h0) = (lay.f, lay.h0);
    // DIR16 vectors have length 1024: positions are fixed point, 1/1024 tile.
    let one = 1024;
    let tile = |p: (i32, i32)| (p.0.div_euclid(one), p.1.div_euclid(one));
    let step = |p: (i32, i32), h: i32| {
        let v = DIR16[h.rem_euclid(16) as usize];
        (p.0 + v[0], p.1 + v[1])
    };
    let near = *lay.run.first()?;
    // A lava tile: free ground off the cone, and `stream_gap` from every other body (except beside its run).
    let lava_ok = |t: (i32, i32)| -> bool {
        let Some(i) = at(t.0, t.1) else {
            return false;
        };
        if mark[i] != 0 || !free(s, t.0, t.1) {
            return false;
        }
        let (dx, dy) = (t.0 - near.0, t.1 - near.1);
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
    // Where the path starts: the pair of the first tile is the run's two outlets moved forward. Across the front (the
    // side cell along the run), from the centre of the run's tile lowest along the side; along the front, from the
    // run's centre, a tile further out when the side cell points back at the cone.
    let sd = side(h0);
    let centre = |t: Cell| (t.0 * one + one / 2, t.1 * one + one / 2);
    let n = lay.run.len() as i32;
    let sum = lay.run.iter().fold((0, 0), |acc, &t| {
        let c = centre(t);
        (acc.0 + c.0, acc.1 + c.1)
    });
    let mid = (sum.0 / n, sum.1 / n);
    let along = sd.0 * lay.u.0 + sd.1 * lay.u.1;
    let p0 = if along == 0 {
        centre(*lay.run.iter().min_by_key(|t| t.0 * sd.0 + t.1 * sd.1)?)
    } else if along > 0 {
        mid
    } else {
        (mid.0 + lay.u.0 * one, mid.1 + lay.u.1 * one)
    };
    let v = DIR16[h0 as usize];
    let mut pos = (p0.0 + d.stream_start * v[0], p0.1 + d.stream_start * v[1]);
    let first = tile(pos);
    if !wide(first, h0) {
        return None;
    }
    // (position, heading, tile) per path tile.
    let mut path = vec![(pos, h0, first)];
    let mut h = h0;
    'grow: while (path.len() as i32) < lay.target + 2 {
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
        // Where the heading changes the pairs can leave a neck: fill it, or end the stream a tile sooner. A band that
        // is not one 4-connected piece would be a ford: end it sooner too.
        if !widen(&mut cells, &lava_ok) || pieces4(&cells) != 1 {
            path.pop();
            continue;
        }
        let pc = tile(step(step(p, hp), hp));
        let mut short = false;
        for &r2 in d.pool_d2 {
            let Some(pool) = pool(&cells, pc, r2, &lava_ok) else {
                continue;
            };
            match length(&cells, &lay.run, &pool) {
                Some(len) if len > lay.target => {}
                Some(len) if len < lay.lo => short = true,
                Some(len) => {
                    return Some(Body {
                        lava: cells,
                        pool,
                        centre: pc,
                        len,
                    })
                }
                None => {}
            }
        }
        // Shortening only shortens: a stream already short of its range does not fit.
        if short {
            return None;
        }
        path.pop();
    }
    None
}

/// The oracle's length of a stream (path tiles): 1 + the fewest 8-connected steps through its lava `cells` from a tile
/// touching (Chebyshev distance at most 1) a tile of its run to a tile touching its pool's lava; `None` when no tile
/// touches either, or they are not joined. A straight stream n tiles long, two wide, measures n.
fn length(cells: &[usize], run: &[Cell], pool: &[usize]) -> Option<i32> {
    let xy = |i: usize| ((i % W) as i32, (i / W) as i32);
    let close = |a: Cell, b: Cell| (a.0 - b.0).abs().max((a.1 - b.1).abs()) <= 1;
    let pts: Vec<Cell> = cells.iter().map(|&i| xy(i)).collect();
    let ends: Vec<Cell> = pool.iter().map(|&i| xy(i)).collect();
    let mut dist: Vec<i32> = vec![0; pts.len()];
    let mut queue: Vec<usize> = Vec::with_capacity(pts.len());
    for (k, &p) in pts.iter().enumerate() {
        if run.iter().any(|&q| close(p, q)) {
            dist[k] = 1;
            queue.push(k);
        }
    }
    let mut head = 0;
    while head < queue.len() {
        let k = queue[head];
        head += 1;
        if ends.iter().any(|&q| close(pts[k], q)) {
            return Some(dist[k]);
        }
        for (j, &q) in pts.iter().enumerate() {
            if dist[j] == 0 && close(pts[k], q) {
                dist[j] = dist[k] + 1;
                queue.push(j);
            }
        }
    }
    None
}

/// The 4-connected pieces of `cells` (a stream that is more than one is a ford).
fn pieces4(cells: &[usize]) -> usize {
    let mut seen = vec![false; cells.len()];
    let mut pieces = 0;
    for s in 0..cells.len() {
        if seen[s] {
            continue;
        }
        pieces += 1;
        seen[s] = true;
        let mut stack = vec![s];
        while let Some(k) = stack.pop() {
            let (x, y) = ((cells[k] % W) as i32, (cells[k] / W) as i32);
            for (j, &c) in cells.iter().enumerate() {
                let (cx, cy) = ((c % W) as i32, (c / W) as i32);
                if !seen[j] && (cx - x).abs() + (cy - y).abs() == 1 {
                    seen[j] = true;
                    stack.push(j);
                }
            }
        }
    }
    pieces
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mapdata::Zone;

    /// The streams as the Landmarks phase lays them, whether or not the attempt later certifies: on every attempt of
    /// seeds 1-12, attempts 0-5, whose Landmarks phase places the volcano, the Fire frame writes the volcano, then
    /// stream and pool per outlet run in grid order; each stream's lava touches its own run only, is one 4-connected
    /// band two tiles wide, measures (`length`) inside its run's `outlet_len` range against its own pool, the middle
    /// strictly the longest; no stream or pool touches another's lava. At least one attempt places it.
    #[test]
    fn landmarks_phase_streams_keep_the_volcano_guarantees() {
        use crate::mapgen::attempt::{begin_attempt_signature, AttemptContext};
        use crate::mapgen::landmarks::{recipes::Recipes, stage::StageContext};
        use FeatureKind::{LavaPool, LavaStream, Volcano};
        let fixed = crate::mapgen::coliseum::fixed_layout();
        let context = AttemptContext::new(&fixed);
        let signature = super::super::SignatureContext::new(&fixed);
        let d = *signature.definition();
        let close = |a: Cell, b: Cell| (a.0 - b.0).abs().max((a.1 - b.1).abs()) <= 1;
        let xy = |i: usize| ((i % W) as i32, (i / W) as i32);
        let mut placed = 0;
        for seed in 1..=12 {
            for n in 0..6 {
                let Some(frame) = begin_attempt_signature(&context, seed, n, true).expect("prefix")
                else {
                    continue;
                };
                let Some(mut stage) = StageContext::new(&fixed)
                    .apply(&frame, &Recipes::default())
                    .expect("stage")
                else {
                    continue;
                };
                let Some(p) = signature
                    .apply_only(&frame, &mut stage, Zone::Fire)
                    .expect("input")
                else {
                    continue;
                };
                placed += 1;
                let f = &p.frames[0];
                let kinds: Vec<FeatureKind> = f.features.iter().map(|&(k, _)| k).collect();
                assert_eq!(
                    kinds,
                    [Volcano, LavaStream, LavaPool, LavaStream, LavaPool, LavaStream, LavaPool],
                    "seed {seed} attempt {n}"
                );
                let runs: Vec<Vec<Cell>> = f
                    .marks
                    .chunks(2)
                    .map(|c| c.iter().map(|m| (m.tile.x, m.tile.y)).collect())
                    .collect();
                let fire: Vec<usize> = (0..stage.state.features.len())
                    .filter(|&k| {
                        stage.state.features[k].zone == Zone::Fire
                            && matches!(stage.state.features[k].kind, LavaStream | LavaPool)
                    })
                    .collect();
                let lava = |k: usize| -> Vec<usize> {
                    (0..W * H)
                        .filter(|&i| {
                            usize::from(stage.state.feature_owner[i]) == k + 1
                                && stage.state.tiles[i] == TILE_LOW
                        })
                        .collect()
                };
                let bodies: Vec<(Vec<usize>, Vec<usize>)> =
                    fire.chunks(2).map(|c| (lava(c[0]), lava(c[1]))).collect();
                let mut lens = Vec::new();
                for (r, (s, pool)) in bodies.iter().enumerate() {
                    let touched: Vec<usize> = (0..runs.len())
                        .filter(|&q| s.iter().any(|&i| runs[q].iter().any(|&t| close(xy(i), t))))
                        .collect();
                    assert_eq!(touched, [r], "seed {seed} attempt {n}: stream {r} runs");
                    assert_eq!(pieces4(s), 1, "seed {seed} attempt {n}: stream {r} ford");
                    assert!(
                        first_thin(s).is_none(),
                        "seed {seed} attempt {n}: stream {r} thin"
                    );
                    let len = length(s, &runs[r], pool).expect("joined");
                    let (lo, hi) = d.outlet_len[r];
                    assert!(
                        (lo..=hi).contains(&len),
                        "seed {seed} attempt {n}: stream {r} length {len}"
                    );
                    lens.push(len);
                }
                assert!(
                    lens[1] > lens[0] && lens[1] > lens[2],
                    "seed {seed} attempt {n}: {lens:?}"
                );
                for a in 0..bodies.len() {
                    for b in a + 1..bodies.len() {
                        let (x, y) = (&bodies[a], &bodies[b]);
                        let touch =
                            x.0.iter()
                                .chain(&x.1)
                                .any(|&i| y.0.iter().chain(&y.1).any(|&j| close(xy(i), xy(j))));
                        assert!(!touch, "seed {seed} attempt {n}: bodies {a} and {b} touch");
                    }
                }
            }
        }
        assert!(placed > 0, "no attempt placed the volcano");
        eprintln!("volcano placed on {placed} of 72 attempts");
    }
}
