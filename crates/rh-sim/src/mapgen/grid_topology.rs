//! Size-free topology, exact floor-only 5/7 and 5/7/11 distance fields.
pub const RING_DX: [i32; 8] = [0, 1, 1, 1, 0, -1, -1, -1];
pub const RING_DY: [i32; 8] = [-1, -1, 0, 1, 1, 1, 0, -1];
pub const SIMPLE: [u8; 256] = simple_table();
const fn simple_table() -> [u8; 256] {
    let mut table = [0; 256];
    let mut m = 0;
    while m < 256 {
        let mut comp = 0;
        let mut q = 0;
        while q < 8 {
            if (m >> q) & 1 != 0 {
                comp = 1 << q;
                break;
            }
            q += 2;
        }
        let mut again = true;
        while again {
            again = false;
            q = 0;
            while q < 8 {
                if (comp >> q) & 1 != 0 {
                    let mut k = 0;
                    while k < 2 {
                        let nb = (q + if k == 0 { 1 } else { 7 }) & 7;
                        if (m >> nb) & 1 != 0 && (comp >> nb) & 1 == 0 {
                            comp |= 1 << nb;
                            again = true;
                        }
                        k += 1;
                    }
                }
                q += 1;
            }
        }
        let mut ok = true;
        q = 0;
        while q < 8 {
            if (m >> q) & 1 != 0 && (comp >> q) & 1 == 0 {
                ok = false;
            }
            q += 2;
        }
        table[m] = if ok { 1 } else { 0 };
        m += 1;
    }
    table
}
pub fn ring_offsets(w: i32) -> [i32; 8] {
    core::array::from_fn(|q| RING_DY[q] * w + RING_DX[q])
}
pub fn nb4_offsets(w: i32) -> [i32; 4] {
    [-w, 1, w, -1]
}
const DX: [i32; 16] = [1, -1, 0, 0, 1, 1, -1, -1, 2, 2, -2, -2, 1, 1, -1, -1];
const DY: [i32; 16] = [0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 2, -2, 2, -2];
const COST: [i32; 16] = [5, 5, 5, 5, 7, 7, 7, 7, 11, 11, 11, 11, 11, 11, 11, 11];
fn corner_offsets(q: usize) -> [(i32, i32); 2] {
    let (dx, dy) = (DX[q], DY[q]);
    if q < 8 {
        [(dx, 0), (0, dy)]
    } else if dx.abs() == 2 {
        [(dx.signum(), 0), (dx.signum(), dy)]
    } else {
        [(0, dy.signum()), (dx, dy.signum())]
    }
}
fn legal_target(tiles: &[u8], w: usize, h: usize, i: usize, q: usize) -> Option<usize> {
    let (x, y) = ((i % w) as i32, (i / w) as i32);
    let (nx, ny) = (x + DX[q], y + DY[q]);
    if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
        return None;
    }
    let j = ny as usize * w + nx as usize;
    if tiles[j] != 0 {
        return None;
    }
    if q >= 4 {
        for (ox, oy) in corner_offsets(q) {
            if tiles[(y + oy) as usize * w + (x + ox) as usize] != 0 {
                return None;
            }
        }
    }
    Some(j)
}
pub fn walk_distances(tiles: &[u8], w: usize, h: usize, from: usize) -> Vec<i32> {
    let mut dist = vec![-1; w * h];
    if tiles.get(from) != Some(&0) {
        return dist;
    }
    let mut best = vec![1 << 30; w * h];
    let mut buckets: [Vec<usize>; 8] = core::array::from_fn(|_| Vec::new());
    best[from] = 0;
    buckets[0].push(from);
    let (mut d, mut left) = (0i32, 1usize);
    while left > 0 {
        while let Some(i) = buckets[(d & 7) as usize].pop() {
            left -= 1;
            if dist[i] >= 0 || best[i] != d {
                continue;
            }
            dist[i] = d;
            let (x, y) = ((i % w) as i32, (i / w) as i32);
            for q in 0..8 {
                let (nx, ny) = (x + RING_DX[q], y + RING_DY[q]);
                if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                    continue;
                }
                let j = ny as usize * w + nx as usize;
                if tiles[j] != 0 {
                    continue;
                }
                let diagonal = q & 1 == 1;
                if diagonal
                    && (tiles[y as usize * w + nx as usize] != 0
                        || tiles[ny as usize * w + x as usize] != 0)
                {
                    continue;
                }
                let nd = d + if diagonal { 7 } else { 5 };
                if nd < best[j] {
                    best[j] = nd;
                    buckets[(nd & 7) as usize].push(j);
                    left += 1;
                }
            }
        }
        d += 1;
    }
    dist
}
/// Seeds have integer values (default zero); scope restricts targets, never seeds/corner cells.
/// As in legacy, negative seed values are accepted; generated maps use nonnegative values.
pub fn walk_field16(
    tiles: &[u8],
    w: usize,
    h: usize,
    seeds: &[i32],
    seed_values: Option<&[i32]>,
    scope: Option<&[u8]>,
) -> Vec<i32> {
    let n = w * h;
    let mut dist = vec![-1; n];
    if seeds.is_empty() {
        return dist;
    }
    let mut best = vec![1 << 30; n];
    let mut order: Vec<usize> = (0..seeds.len()).collect();
    let value = |k: usize| seed_values.map_or(0, |v| v[k]);
    // The legacy packed Float64 keys sort value, then original seed index.
    if let Some(values) = seed_values {
        if values.windows(2).any(|p| p[1] < p[0]) {
            let lo = *values.iter().min().expect("nonempty seed values");
            order.sort_by(|&a, &b| {
                let ka = (f64::from(values[a]) - f64::from(lo)) * 2097152.0 + a as f64;
                let kb = (f64::from(values[b]) - f64::from(lo)) * 2097152.0 + b as f64;
                ka.total_cmp(&kb)
            });
        }
    }
    let mut c = value(order[0]);
    let mut buckets: [Vec<usize>; 16] = core::array::from_fn(|_| Vec::new());
    let (mut sp, mut left) = (0, 0usize);
    while left > 0 || sp < seeds.len() {
        if left == 0 {
            c = c.max(value(order[sp]));
        }
        while sp < seeds.len() {
            let k = order[sp];
            if value(k) > c {
                break;
            }
            sp += 1;
            let s = seeds[k];
            if s < 0 || s as usize >= n || tiles[s as usize] != 0 {
                continue;
            }
            let s = s as usize;
            if c < best[s] {
                best[s] = c;
                buckets[(c & 15) as usize].push(s);
                left += 1;
            }
        }
        while let Some(i) = buckets[(c & 15) as usize].pop() {
            left -= 1;
            if dist[i] >= 0 || best[i] != c {
                continue;
            }
            dist[i] = c;
            for (q, cost) in COST.iter().enumerate() {
                let Some(j) = legal_target(tiles, w, h, i, q) else {
                    continue;
                };
                if scope.is_some_and(|s| s[j] != 1) {
                    continue;
                }
                let nd = c + cost;
                if nd < best[j] {
                    best[j] = nd;
                    buckets[(nd & 15) as usize].push(j);
                    left += 1;
                }
            }
        }
        // Once the final seed is consumed and no queue remains, legacy's
        // unbounded Number cursor is never observed again. Avoid overflowing
        // i32 here for an ignored seed at i32::MAX.
        if left > 0 || sp < seeds.len() {
            c += 1;
        }
    }
    dist
}
pub fn descent_path(field: &[i32], tiles: &[u8], w: usize, h: usize, from: i32) -> Vec<i32> {
    let mut out = vec![from];
    if from < 0 || from as usize >= w * h || field[from as usize] < 0 {
        return out;
    }
    let mut i = from as usize;
    for _ in 0..w * h {
        let mut best_v = field[i];
        let mut bj = None;
        for q in 0..16 {
            let Some(j) = legal_target(tiles, w, h, i, q) else {
                continue;
            };
            let v = field[j];
            if v < 0 {
                continue;
            }
            if v < best_v {
                best_v = v;
                bj = Some(j);
            } else if v == best_v && bj.is_some_and(|old| j < old) {
                bj = Some(j);
            }
        }
        let Some(j) = bj else {
            break;
        };
        out.push(j as i32);
        i = j;
    }
    out
}
/// Centre-to-centre integer supercover. Outside and a vertex's two side cells block.
/// `mask = 1` is legacy sight; `255` is movement.
#[allow(clippy::too_many_arguments)]
pub fn segment_blocked(
    tiles: &[u8],
    w: usize,
    h: usize,
    ax: i32,
    ay: i32,
    bx: i32,
    by: i32,
    mask: u8,
) -> bool {
    let blocked = |x: i32, y: i32| {
        x < 0
            || y < 0
            || x >= w as i32
            || y >= h as i32
            || tiles[y as usize * w + x as usize] & mask != 0
    };
    if blocked(ax, ay) {
        return true;
    }
    let (dx, dy) = (i64::from(bx) - i64::from(ax), i64::from(by) - i64::from(ay));
    let (adx, ady) = (dx.abs(), dy.abs());
    let (sx, sy) = (dx.signum() as i32, dy.signum() as i32);
    let (mut tx, mut ty, mut nx, mut ny) = (ax, ay, 0i64, 0i64);
    while nx < adx || ny < ady {
        let (cross_x, cross_y) = if nx >= adx {
            (false, true)
        } else if ny >= ady {
            (true, false)
        } else {
            let lhs = (2 * nx + 1) * ady;
            let rhs = (2 * ny + 1) * adx;
            (lhs <= rhs, lhs >= rhs)
        };
        if cross_x && cross_y && (blocked(tx + sx, ty) || blocked(tx, ty + sy)) {
            return true;
        }
        if cross_x {
            tx += sx;
            nx += 1;
        }
        if cross_y {
            ty += sy;
            ny += 1;
        }
        if blocked(tx, ty) {
            return true;
        }
    }
    false
}
