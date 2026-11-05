use super::{Definition, Noise, DIR8};
use crate::map::TILE_FLOOR;
use std::cmp::Reverse;
use std::collections::BinaryHeap;
/// Borrowed path context; callers create a fresh view when protected tiles change.
pub struct PathSource<'a> {
    pub w: usize,
    pub h: usize,
    pub mask: &'a [u8],
    pub hard: &'a [u8],
    pub tiles: &'a [u8],
    pub noise: &'a Noise,
}
pub enum PathCost<'a> {
    None,
    Map(&'a [i32]),
    Callback(&'a mut dyn FnMut(usize) -> i32),
}
/// Eight-neighbor Dijkstra, strict improvements, cost/index heap ties. Callback sampled once per encountered tile.
pub fn noisy_path(
    c: &PathSource<'_>,
    a: usize,
    b: usize,
    salt: f64,
    mut cost: PathCost<'_>,
    r: &Definition,
) -> Vec<usize> {
    let (w, h) = (c.w, c.h);
    let n = w * h;
    assert!(
        w > 0
            && h > 0
            && a < n
            && b < n
            && c.mask.len() == n
            && c.hard.len() == n
            && c.tiles.len() == n
    );
    if let PathCost::Map(v) = &cost {
        assert_eq!(v.len(), n)
    }
    let mut near = vec![false; n];
    for i in 0..n {
        if c.hard[i] == 0 || c.mask[i] == 0 {
            continue;
        }
        let (x, y) = ((i % w) as i32, (i / w) as i32);
        for dy in -r.hard_radius..=r.hard_radius {
            for dx in -r.hard_radius..=r.hard_radius {
                let (nx, ny) = (x + dx, y + dy);
                if nx >= 0 && ny >= 0 && (nx as usize) < w && (ny as usize) < h {
                    near[ny as usize * w + nx as usize] = true
                }
            }
        }
    }
    let mut dist = vec![r.path_far; n];
    let mut from = vec![None; n];
    let mut noise = vec![None; n];
    let mut extra = vec![None; n];
    let mut heap = BinaryHeap::new();
    dist[a] = 0;
    heap.push(Reverse((0, a)));
    while let Some(Reverse((d, i))) = heap.pop() {
        if d > dist[i] {
            continue;
        }
        if i == b {
            break;
        }
        let (x, y) = ((i % w) as i32, (i / w) as i32);
        for (q, [dx, dy]) in DIR8.into_iter().enumerate() {
            let (nx, ny) = (x + dx, y + dy);
            if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                continue;
            }
            let j = ny as usize * w + nx as usize;
            if c.mask[j] == 0 || c.tiles[j] != TILE_FLOOR {
                continue;
            }
            let noise = *noise[j].get_or_insert_with(|| {
                (c.noise.value(nx as f64, ny as f64, r.noise_cell, salt) * r.noise_scale).floor()
                    as i32
            });
            let add = match &mut cost {
                PathCost::None => 0,
                PathCost::Map(v) => v[j],
                PathCost::Callback(f) => *extra[j].get_or_insert_with(|| f(j)),
            };
            assert!(add >= 0, "path costs must be nonnegative");
            let nd = i64::from(d)
                + i64::from(if q & 1 == 1 {
                    r.path_diagonal
                } else {
                    r.path_orthogonal
                })
                + i64::from(noise)
                + i64::from(if near[j] { r.hard_penalty } else { 0 })
                + i64::from(add);
            if nd < i64::from(dist[j]) {
                dist[j] = nd as i32;
                from[j] = Some(i);
                heap.push(Reverse((nd as i32, j)));
            }
        }
    }
    if from[b].is_none() && a != b {
        return Vec::new();
    }
    let mut path = vec![b];
    let mut i = b;
    while i != a {
        let Some(p) = from[i] else { break };
        path.push(p);
        i = p
    }
    path.reverse();
    path
}
pub fn viterbi_rows(
    value: &[i32],
    lo: i32,
    gap_min: i32,
    gap_max: i32,
    gap_target: i32,
    gap_penalty: f64,
) -> Vec<i32> {
    let n = value.len();
    if n == 0 {
        return Vec::new();
    }
    let gmin = gap_min.max(1);
    let mut dp = vec![0.0; n];
    let mut par = vec![None; n];
    for t in 0..n {
        let (mut best, mut bq) = (0.0, None);
        let start = (t as i32 - gap_max).max(0);
        let end = t as i32 - gmin;
        for q in start..=end {
            let cand = dp[q as usize] - gap_penalty * f64::from((t as i32 - q - gap_target).abs());
            if cand > best {
                best = cand;
                bq = Some(q as usize)
            }
        }
        dp[t] = f64::from(value[t]) + best;
        par[t] = bq
    }
    let (mut bt, mut bv) = (0, f64::NEG_INFINITY);
    for (t, &v) in dp.iter().enumerate() {
        if v > bv {
            bv = v;
            bt = t
        }
    }
    if bv <= 0.0 {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut t = Some(bt);
    while let Some(i) = t {
        out.push(lo + i as i32);
        t = par[i]
    }
    out.reverse();
    out
}
/// Integer costs are sampled once for every state in source order; offset bounds fit Int8Array.
pub fn viterbi_path(
    n: usize,
    half: i8,
    mut step_cost: impl FnMut(usize, i8) -> i32,
    jog_cost: f64,
) -> Vec<i8> {
    assert!((0..=127).contains(&half));
    let mut out = vec![0; n];
    if n == 0 {
        return out;
    }
    let half = i32::from(half);
    let width = (2 * half + 1) as usize;
    let mut cost = vec![0.0; n * width];
    let mut from = vec![0_i8; n * width];
    for (w, cost) in cost.iter_mut().take(width).enumerate() {
        *cost = f64::from(step_cost(0, (w as i32 - half) as i8))
    }
    for s in 1..n {
        for w in 0..width {
            let (mut best, mut bd, mut bo) = (f64::INFINITY, 0, 0_i32);
            for dw in -1..=1 {
                let pw = w as i32 + dw;
                if pw < 0 || pw >= width as i32 {
                    continue;
                }
                let v = cost[(s - 1) * width + pw as usize] + if dw != 0 { jog_cost } else { 0.0 };
                let po = pw - half;
                if v < best || (v == best && (po.abs(), po) < (bo.abs(), bo)) {
                    best = v;
                    bd = dw;
                    bo = po
                }
            }
            cost[s * width + w] = best + f64::from(step_cost(s, (w as i32 - half) as i8));
            from[s * width + w] = bd as i8
        }
    }
    let (mut w, mut bc) = (0, f64::INFINITY);
    for k in 0..width {
        let v = cost[(n - 1) * width + k];
        let (o, bo) = (k as i32 - half, w as i32 - half);
        if v < bc || (v == bc && (o.abs(), o) < (bo.abs(), bo)) {
            bc = v;
            w = k
        }
    }
    for s in (0..n).rev() {
        out[s] = (w as i32 - half) as i8;
        if s > 0 {
            w = (w as i32 + i32::from(from[s * width + w])) as usize
        }
    }
    out
}
