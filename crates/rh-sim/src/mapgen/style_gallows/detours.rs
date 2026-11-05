//! Private planned-grid scratch matches the source L shortcut/BFS; it never touches runtime scratch.
use super::rows::RowPlan;
use super::*;
use std::collections::BTreeSet;
struct Scratch {
    seen: Vec<i32>,
    queue: Vec<usize>,
    depth: Vec<i16>,
    stamp: i32,
}
impl Scratch {
    fn new(n: usize) -> Self {
        Self {
            seen: vec![0; n],
            queue: vec![0; n],
            depth: vec![0; n],
            stamp: 0,
        }
    }
}
#[allow(clippy::too_many_arguments)]
fn detour_holds(
    tiles: &[u8],
    mask: &[u8],
    w: usize,
    h: usize,
    i: usize,
    cap: usize,
    sc: &mut Scratch,
    reach: usize,
) -> bool {
    let (x, y) = (i % w, i / w);
    for pass in 0..2 {
        let step = if pass == 0 { w } else { 1 };
        let along = if pass == 0 { 1 } else { w };
        for k in 1..=reach {
            if if pass == 0 {
                y < k || y + k >= h
            } else {
                x < k || x + k >= w
            } {
                break;
            }
            let (a, b) = (i - k * step, i + k * step);
            if tiles[a] != TILE_FLOOR || tiles[b] != TILE_FLOOR || mask[a] == 0 || mask[b] == 0 {
                break;
            }
            let limit = 2 * k + cap;
            let mut ok = false;
            for dir in [-1, 1] {
                if ok {
                    break;
                }
                let mut d = 1;
                while 2 * d + 2 * k <= limit {
                    let g = i as i64 + i64::from(dir) * d as i64 * along as i64;
                    let (gx, gy) = if pass == 0 {
                        (x as i64 + i64::from(dir) * d as i64, y as i64)
                    } else {
                        (x as i64, y as i64 + i64::from(dir) * d as i64)
                    };
                    if gx < 0 || gy < 0 || gx >= w as i64 || gy >= h as i64 {
                        break;
                    }
                    let g = g as usize;
                    if tiles[g] == TILE_LOW {
                        d += 1;
                        continue;
                    }
                    if tiles[g] != TILE_FLOOR || mask[g] == 0 {
                        break;
                    }
                    let mut clear = true;
                    for q in -(k as i64)..=k as i64 {
                        if !clear {
                            break;
                        }
                        let t = (g as i64 + q * step as i64) as usize;
                        if tiles[t] != TILE_FLOOR || mask[t] == 0 {
                            clear = false
                        }
                    }
                    for q in 1..=d {
                        if !clear {
                            break;
                        }
                        let ta = (a as i64 + i64::from(dir) * q as i64 * along as i64) as usize;
                        let tb = (b as i64 + i64::from(dir) * q as i64 * along as i64) as usize;
                        if tiles[ta] != TILE_FLOOR
                            || mask[ta] == 0
                            || tiles[tb] != TILE_FLOOR
                            || mask[tb] == 0
                        {
                            clear = false
                        }
                    }
                    if clear {
                        ok = true
                    }
                    break;
                }
            }
            if ok {
                continue;
            }
            sc.stamp += 1;
            let stamp = sc.stamp;
            let (mut head, mut tail, mut found) = (0, 1, false);
            sc.queue[0] = a;
            sc.seen[a] = stamp;
            sc.depth[a] = 0;
            while head < tail {
                let cur = sc.queue[head];
                head += 1;
                if cur == b {
                    found = true;
                    break;
                }
                if sc.depth[cur] as usize >= limit {
                    continue;
                }
                let (cx, cy) = ((cur % w) as i32, (cur / w) as i32);
                for (nx, ny) in [(cx, cy - 1), (cx + 1, cy), (cx, cy + 1), (cx - 1, cy)] {
                    if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                        continue;
                    }
                    let j = ny as usize * w + nx as usize;
                    if j == i || sc.seen[j] == stamp || tiles[j] != TILE_FLOOR || mask[j] == 0 {
                        continue;
                    }
                    sc.seen[j] = stamp;
                    sc.depth[j] = sc.depth[cur] + 1;
                    sc.queue[tail] = j;
                    tail += 1;
                }
            }
            if !found {
                return false;
            }
        }
    }
    true
}
fn near_tiles(
    tiles: impl IntoIterator<Item = i32>,
    w: usize,
    h: usize,
    radius: i32,
) -> BTreeSet<i32> {
    let mut out = BTreeSet::new();
    for i in tiles {
        let (x, y) = (i % w as i32, i / w as i32);
        for dy in -radius..=radius {
            for dx in -radius..=radius {
                let (nx, ny) = (x + dx, y + dy);
                if nx >= 0 && ny >= 0 && nx < w as i32 && ny < h as i32 {
                    out.insert(ny * w as i32 + nx);
                }
            }
        }
    }
    out
}
impl Callbacks<'_> {
    pub(super) fn plan_detours(
        &self,
        c: &ShapeContext<'_, '_>,
        rows: &mut [RowPlan],
        cap: usize,
        out: &mut Vec<i32>,
    ) -> usize {
        let b = c.base();
        let (w, h) = (b.w, b.h);
        let mut sim = b.tiles.to_vec();
        for r in rows.iter() {
            for &i in &r.blocks {
                sim[i as usize] = TILE_LOW
            }
        }
        let mut sc = Scratch::new(w * h);
        let mut dropped = 0;
        let mut recheck: Option<BTreeSet<i32>> = None;
        for _ in 0..self.definition.plan_rounds {
            let mut bad = Vec::new();
            for r in rows.iter() {
                for &i in &r.blocks {
                    if sim[i as usize] != TILE_LOW
                        || recheck.as_ref().is_some_and(|set| !set.contains(&i))
                    {
                        continue;
                    }
                    if !detour_holds(
                        &sim,
                        b.mask,
                        w,
                        h,
                        i as usize,
                        cap,
                        &mut sc,
                        self.definition.detour_pair_reach,
                    ) {
                        bad.push(i)
                    }
                }
            }
            for &i in &bad {
                sim[i as usize] = TILE_FLOOR
            }
            let mut gone = bad;
            for r in rows.iter() {
                for &start in &r.blocks {
                    if sim[start as usize] != TILE_LOW {
                        continue;
                    }
                    let mut comp = vec![start];
                    sc.stamp += 1;
                    let stamp = sc.stamp;
                    sc.seen[start as usize] = stamp;
                    let mut head = 0;
                    while head < comp.len() && comp.len() < self.definition.min_piece {
                        let (x, y) = (comp[head] % w as i32, comp[head] / w as i32);
                        head += 1;
                        for dy in -1..=1 {
                            for dx in -1..=1 {
                                let (nx, ny) = (x + dx, y + dy);
                                if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                                    continue;
                                }
                                let j = (ny * w as i32 + nx) as usize;
                                if sim[j] == TILE_LOW && sc.seen[j] != stamp && b.mask[j] != 0 {
                                    sc.seen[j] = stamp;
                                    comp.push(j as i32)
                                }
                            }
                        }
                    }
                    if comp.len() < self.definition.min_piece {
                        for i in comp {
                            sim[i as usize] = TILE_FLOOR;
                            gone.push(i)
                        }
                    }
                }
            }
            dropped += gone.len();
            if gone.is_empty() {
                break;
            }
            recheck = Some(near_tiles(gone, w, h, self.definition.detour_reach));
        }
        for r in rows {
            for &i in &r.blocks {
                if sim[i as usize] != TILE_LOW {
                    out.push(i)
                }
            }
            r.blocks.retain(|&i| sim[i as usize] == TILE_LOW);
            r.posts.retain(|&i| sim[i as usize] == TILE_LOW);
        }
        dropped
    }
    fn add_small_pieces(&self, c: &ShapeContext<'_, '_>, plan: &Plan, rel: &mut BTreeSet<i32>) {
        let b = c.base();
        let (w, h) = (b.w, b.h);
        let live: BTreeSet<_> = plan
            .rows
            .iter()
            .flat_map(|r| r.tiles.iter().copied())
            .filter(|i| !rel.contains(i))
            .collect();
        let mut seen = BTreeSet::new();
        for &start in &live {
            if seen.contains(&start) {
                continue;
            }
            let mut comp = vec![start];
            seen.insert(start);
            let mut head = 0;
            while head < comp.len() {
                let (x, y) = (comp[head] % w as i32, comp[head] / w as i32);
                head += 1;
                for dy in -1..=1 {
                    for dx in -1..=1 {
                        let (nx, ny) = (x + dx, y + dy);
                        if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                            continue;
                        }
                        let j = ny * w as i32 + nx;
                        if live.contains(&j) && !seen.contains(&j) {
                            seen.insert(j);
                            comp.push(j)
                        }
                    }
                }
            }
            if comp.len() < self.definition.min_piece {
                rel.extend(comp)
            }
        }
    }
    fn give_back(
        &self,
        c: &mut ShapeContext<'_, '_>,
        plan: &mut Plan,
        mut rel: BTreeSet<i32>,
        keep_rows: bool,
    ) -> usize {
        if rel.is_empty() {
            return 0;
        }
        self.add_small_pieces(c, plan, &mut rel);
        if keep_rows {
            for row in &plan.rows {
                if !row.tiles.is_empty() && row.tiles.iter().all(|i| rel.contains(i)) {
                    for i in &row.tiles {
                        rel.remove(i);
                    }
                }
            }
        }
        let mut released = 0;
        for i in rel {
            if c.release(i) {
                released += 1
            }
        }
        let b = c.base();
        for row in &mut plan.rows {
            row.tiles.retain(|&i| b.tiles[i as usize] == TILE_LOW);
            row.posts.retain(|&i| b.tiles[i as usize] == TILE_LOW);
        }
        released
    }
    pub(super) fn open_around(
        &self,
        c: &mut ShapeContext<'_, '_>,
        plan: &mut Plan,
        band: &[i32],
        radius: i32,
    ) -> usize {
        let b = c.base();
        let near = near_tiles(band.iter().copied(), b.w, b.h, radius);
        let rel = plan
            .rows
            .iter()
            .flat_map(|r| r.tiles.iter().copied())
            .filter(|i| near.contains(i))
            .collect();
        self.give_back(c, plan, rel, true)
    }
    pub(super) fn relax_rows(
        &self,
        c: &mut ShapeContext<'_, '_>,
        plan: &mut Plan,
        holes: &[i32],
    ) -> usize {
        if holes.is_empty() {
            return 0;
        }
        let b = c.base();
        let near = near_tiles(
            holes.iter().copied(),
            b.w,
            b.h,
            self.definition.detour_reach,
        );
        let mut total = 0;
        for _ in 0..self.definition.relax_rounds {
            let mut rel = BTreeSet::new();
            for row in &plan.rows {
                for &i in &row.tiles {
                    if near.contains(&i)
                        && c.base().tiles[i as usize] == TILE_LOW
                        && !c.fence_detour_ok(i)
                    {
                        rel.insert(i);
                    }
                }
            }
            let n = self.give_back(c, plan, rel, false);
            if n == 0 {
                break;
            }
            total += n;
        }
        total
    }
}
