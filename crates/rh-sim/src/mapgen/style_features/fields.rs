use super::Definition;
fn grid(n: usize, w: usize, h: usize) {
    assert!(w > 0 && h > 0 && n == w * h)
}
/// Source neighbor order for four-connected floods: left,right,up,down.
fn neighbors(i: usize, w: usize, h: usize) -> [Option<usize>; 4] {
    let x = i % w;
    [
        if x > 0 { Some(i - 1) } else { None },
        if x + 1 < w { Some(i + 1) } else { None },
        if i >= w { Some(i - w) } else { None },
        if i < w * h - w { Some(i + w) } else { None },
    ]
}
pub fn chamfer_from(sources: &[i32], w: usize, h: usize, r: &Definition) -> Vec<i32> {
    assert!(w > 0 && h > 0);
    let mut d = vec![r.chamfer_far; w * h];
    for &s in sources {
        if s >= 0 && (s as usize) < d.len() {
            d[s as usize] = 0
        }
    }
    for reverse in [false, true] {
        for k in 0..w * h {
            let i = if reverse { w * h - 1 - k } else { k };
            if d[i] == 0 {
                continue;
            }
            let (x, y) = ((i % w) as i32, (i / w) as i32);
            let dy = if reverse { 1 } else { -1 };
            let dx = if reverse { 1 } else { -1 };
            for (ox, oy, cost) in [
                (dx, 0, r.chamfer_orthogonal),
                (0, dy, r.chamfer_orthogonal),
                (dx, dy, r.chamfer_diagonal),
                (-dx, dy, r.chamfer_diagonal),
            ] {
                let (nx, ny) = (x + ox, y + oy);
                if nx >= 0 && ny >= 0 && (nx as usize) < w && (ny as usize) < h {
                    d[i] = d[i].min(d[ny as usize * w + nx as usize] + cost)
                }
            }
        }
    }
    d
}
pub fn majority_smooth(
    set: &[u8],
    allow: &[u8],
    w: usize,
    h: usize,
    passes: usize,
    threshold: Option<i32>,
    rules: &Definition,
) -> Vec<u8> {
    let threshold = threshold.unwrap_or(rules.majority_threshold);
    grid(set.len(), w, h);
    grid(allow.len(), w, h);
    let mut cur: Vec<_> = set.iter().map(|&v| u8::from(v != 0)).collect();
    let mut next = vec![0; w * h];
    for _ in 0..passes {
        for y in 0..h {
            for x in 0..w {
                let mut sum = 0;
                for ny in y.saturating_sub(1)..=(y + 1).min(h - 1) {
                    for nx in x.saturating_sub(1)..=(x + 1).min(w - 1) {
                        sum += i32::from(cur[ny * w + nx])
                    }
                }
                let i = y * w + x;
                next[i] = u8::from(allow[i] != 0 && sum >= threshold)
            }
        }
        std::mem::swap(&mut cur, &mut next)
    }
    cur
}
#[derive(Debug, PartialEq, Eq)]
pub struct Components {
    pub label: Vec<i32>,
    pub sizes: Vec<usize>,
}
pub fn components_of(set: &[u8], w: usize, h: usize, eight: bool) -> Components {
    grid(set.len(), w, h);
    let mut label = vec![-1; set.len()];
    let mut sizes = Vec::new();
    let mut queue = Vec::new();
    for s in 0..set.len() {
        if set[s] != 1 || label[s] >= 0 {
            continue;
        }
        queue.clear();
        queue.push(s);
        label[s] = sizes.len() as i32;
        let mut head = 0;
        while head < queue.len() {
            let i = queue[head];
            head += 1;
            let (x, y) = ((i % w) as i32, (i / w) as i32);
            for dy in -1..=1 {
                let ny = y + dy;
                if ny < 0 || ny >= h as i32 {
                    continue;
                }
                for dx in -1..=1 {
                    if (dx == 0 && dy == 0) || (!eight && dx != 0 && dy != 0) {
                        continue;
                    }
                    let nx = x + dx;
                    if nx < 0 || nx >= w as i32 {
                        continue;
                    }
                    let j = ny as usize * w + nx as usize;
                    if set[j] == 1 && label[j] < 0 {
                        label[j] = sizes.len() as i32;
                        queue.push(j)
                    }
                }
            }
        }
        sizes.push(queue.len())
    }
    Components { label, sizes }
}
pub fn prune_small(set: &mut [u8], w: usize, h: usize, min: usize, eight: bool) -> usize {
    let c = components_of(set, w, h, eight);
    let mut cleared = 0;
    for (i, &label) in c.label.iter().enumerate() {
        if label >= 0 && c.sizes[label as usize] < min {
            set[i] = 0;
            cleared += 1
        }
    }
    cleared
}
#[derive(Debug, PartialEq, Eq)]
pub struct Flood {
    pub set: Vec<u8>,
    pub size: usize,
}
pub fn flood_above(
    value: &[i32],
    tau: i32,
    seed: isize,
    allow: &[u8],
    w: usize,
    h: usize,
) -> Flood {
    grid(value.len(), w, h);
    grid(allow.len(), w, h);
    let mut set = vec![0; value.len()];
    if seed < 0
        || seed as usize >= value.len()
        || allow[seed as usize] == 0
        || value[seed as usize] < tau
    {
        return Flood { set, size: 0 };
    }
    let mut queue = vec![seed as usize];
    set[seed as usize] = 1;
    let mut head = 0;
    while head < queue.len() {
        let i = queue[head];
        head += 1;
        for j in neighbors(i, w, h).into_iter().flatten() {
            if set[j] == 0 && allow[j] != 0 && value[j] >= tau {
                set[j] = 1;
                queue.push(j)
            }
        }
    }
    Flood {
        set,
        size: queue.len(),
    }
}
pub fn tau_for_area(
    value: &[i32],
    seed: isize,
    allow: &[u8],
    w: usize,
    h: usize,
    target: usize,
) -> i32 {
    grid(value.len(), w, h);
    grid(allow.len(), w, h);
    if seed < 0 || seed as usize >= value.len() {
        return 0;
    }
    let seed = seed as usize;
    if allow[seed] == 0 {
        return value[seed];
    }
    let region = flood_above(value, i32::MIN, seed as isize, allow, w, h);
    let mut vals: Vec<_> = value
        .iter()
        .enumerate()
        .filter_map(|(i, &v)| (region.set[i] != 0).then_some(v))
        .collect();
    vals.sort_unstable();
    vals.dedup();
    if region.size < target {
        return vals[0];
    }
    let (mut lo, mut hi) = (0, vals.len() - 1);
    while hi > 0 && vals[hi] > value[seed] {
        hi -= 1
    }
    while lo < hi {
        let mid = (lo + hi).div_ceil(2);
        if flood_above(value, vals[mid], seed as isize, allow, w, h).size >= target {
            lo = mid
        } else {
            hi = mid - 1
        }
    }
    vals[lo]
}
