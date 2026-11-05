use super::{ZoneDefinition, N, W, ZONES};
use crate::mapgen::grid_ops::{NB4, RING_OFF, SIMPLE};
// Encoding of the legacy Int32 heap key, not a tunable gameplay value.
const KEY: i32 = 32768;
#[derive(Default)]
struct Heap {
    a: Vec<i32>,
}
impl Heap {
    fn push(&mut self, key: i32) {
        let mut i = self.a.len();
        self.a.push(key);
        while i > 0 {
            let p = (i - 1) >> 1;
            if self.a[p] <= key {
                break;
            }
            self.a[i] = self.a[p];
            i = p;
        }
        self.a[i] = key;
    }
    fn top(&self) -> i32 {
        self.a[0]
    }
    fn pop(&mut self) -> i32 {
        let r = self.a[0];
        let key = self.a.pop().expect("nonempty heap");
        let mut i = 0;
        loop {
            let mut c = 2 * i + 1;
            if c >= self.a.len() {
                break;
            }
            if c + 1 < self.a.len() && self.a[c + 1] < self.a[c] {
                c += 1;
            }
            if self.a[c] >= key {
                break;
            }
            self.a[i] = self.a[c];
            i = c;
        }
        if !self.a.is_empty() {
            self.a[i] = key;
        }
        r
    }
    fn is_empty(&self) -> bool {
        self.a.is_empty()
    }
}
fn at(t: usize, off: i32) -> usize {
    (t as i32 + off) as usize
}
pub(super) fn spine(zone: &mut [u8], mask: &[u8], cost: &[i32], z: u8, target: usize) -> bool {
    if zone[target] == z {
        return true;
    }
    let mut heap = Heap::default();
    let mut best = vec![-1; N];
    let mut prev = vec![-1; N];
    let mut done = vec![false; N];
    for i in 0..N {
        if zone[i] == z {
            best[i] = 0;
            heap.push(i as i32);
        }
    }
    while !heap.is_empty() {
        let key = heap.pop();
        let t = (key % KEY) as usize;
        let c = (key - t as i32) / KEY;
        if done[t] {
            continue;
        }
        done[t] = true;
        if t == target {
            break;
        }
        for off in NB4 {
            let j = at(t, off);
            if mask[j] == 0 || zone[j] != 0 || done[j] {
                continue;
            }
            let nc = c + cost[j];
            if best[j] < 0 || nc < best[j] {
                best[j] = nc;
                prev[j] = t as i32;
                heap.push(nc * KEY + j as i32);
            }
        }
    }
    if !done[target] {
        return false;
    }
    let mut t = target as i32;
    while t >= 0 && zone[t as usize] != z {
        zone[t as usize] = z;
        t = prev[t as usize];
    }
    true
}
pub(super) fn grow_quota(
    mask: &[u8],
    tiles: &[usize],
    owner: &mut [u8],
    cost: &[i32],
    quota: &[i32; ZONES + 1],
    protect: &[u8],
    rules: &ZoneDefinition,
) -> bool {
    let mut size = [0; ZONES + 1];
    let mut free = 0usize;
    let mut heaps: [Heap; ZONES + 1] = core::array::from_fn(|_| Heap::default());
    for &t in tiles {
        let z = owner[t] as usize;
        if z == 0 {
            free += 1;
            continue;
        }
        size[z] += 1;
        for off in NB4 {
            let j = at(t, off);
            if mask[j] != 0 && owner[j] == 0 {
                heaps[z].push(cost[j] * KEY + j as i32);
            }
        }
    }
    for phase in 0..2 {
        if free == 0 {
            break;
        }
        loop {
            let mut z = 0;
            for q in 1..=ZONES {
                if phase == 0 && size[q] >= quota[q] {
                    continue;
                }
                let h = &mut heaps[q];
                while !h.is_empty() && owner[(h.top() % KEY) as usize] != 0 {
                    h.pop();
                }
                if !h.is_empty() && (z == 0 || size[q] - quota[q] < size[z] - quota[z]) {
                    z = q;
                }
            }
            if z == 0 {
                break;
            }
            let key = heaps[z].pop();
            let t = (key % KEY) as usize;
            let c = (key - t as i32) / KEY;
            owner[t] = z as u8;
            size[z] += 1;
            free -= 1;
            for off in NB4 {
                let j = at(t, off);
                if mask[j] != 0 && owner[j] == 0 {
                    heaps[z].push((c + cost[j]) * KEY + j as i32);
                }
            }
            if free == 0 {
                break;
            }
        }
    }
    free == 0 && balance(mask, tiles, owner, quota, protect, rules)
}
pub(super) fn balance(
    mask: &[u8],
    tiles: &[usize],
    owner: &mut [u8],
    quota: &[i32; ZONES + 1],
    protect: &[u8],
    rules: &ZoneDefinition,
) -> bool {
    let mut size = [0; ZONES + 1];
    for &t in tiles {
        size[owner[t] as usize] += 1;
    }
    let mut adj = [[false; ZONES + 1]; ZONES + 1];
    for _ in 0..rules.balance_rounds {
        let (mut lo, mut hi) = (1, 1);
        for z in 2..=ZONES {
            if size[z] - quota[z] < size[lo] - quota[lo] {
                lo = z;
            }
            if size[z] - quota[z] > size[hi] - quota[hi] {
                hi = z;
            }
        }
        if (size[hi] - quota[hi]) - (size[lo] - quota[lo]) <= rules.balance_tolerance {
            return true;
        }
        let m = 1.max((size[hi] - quota[hi]).min(quota[lo] - size[lo]));
        adj.fill([false; ZONES + 1]);
        for &t in tiles {
            let a = owner[t] as usize;
            for j in [t + 1, t + W] {
                if mask[j] != 0 && owner[j] as usize != a {
                    adj[a][owner[j] as usize] = true;
                    adj[owner[j] as usize][a] = true;
                }
            }
        }
        let mut prev = [-1; ZONES + 1];
        prev[hi] = hi as i32;
        let mut queue = vec![hi];
        let mut head = 0;
        while head < queue.len() {
            let u = queue[head];
            head += 1;
            for v in 1..=ZONES {
                if adj[u][v] && prev[v] < 0 {
                    prev[v] = u as i32;
                    queue.push(v);
                }
            }
        }
        if prev[lo] < 0 {
            return false;
        }
        let mut chain = Vec::new();
        let mut v = lo;
        while v != hi {
            chain.push(v);
            v = prev[v] as usize;
        }
        chain.push(hi);
        let mut progressed = false;
        for c in (1..chain.len()).rev() {
            let (from, to) = (chain[c], chain[c - 1]);
            let got = peel(mask, tiles, owner, from as u8, to as u8, m, protect, rules);
            size[to] += got;
            size[from] -= got;
            if got > 0 {
                progressed = true;
            }
            if got < m {
                break;
            }
        }
        if !progressed {
            return false;
        }
    }
    true
}
fn score(t: usize, mask: &[u8], owner: &[u8], from: u8, to: u8, rules: &ZoneDefinition) -> i32 {
    let (mut n_to, mut n_from) = (0, 0);
    for off in NB4 {
        let j = at(t, off);
        if mask[j] == 0 {
            continue;
        }
        if owner[j] == to {
            n_to += 1;
        } else if owner[j] == from {
            n_from += 1;
        }
    }
    if n_to == 0 || n_from == 0 {
        -1
    } else {
        rules.peel_to_weight * n_to - n_from + rules.peel_bias
    }
}
#[allow(clippy::too_many_arguments)]
fn peel(
    mask: &[u8],
    tiles: &[usize],
    owner: &mut [u8],
    from: u8,
    to: u8,
    m: i32,
    protect: &[u8],
    rules: &ZoneDefinition,
) -> i32 {
    let mut h = Heap::default();
    for &t in tiles {
        if owner[t] != from || protect[t] != 0 {
            continue;
        }
        let s = score(t, mask, owner, from, to, rules);
        if s > 0 {
            h.push((rules.peel_ceiling - s) * KEY + t as i32);
        }
    }
    let mut moved = 0;
    while moved < m && !h.is_empty() {
        let key = h.pop();
        let t = (key % KEY) as usize;
        let key_score = rules.peel_ceiling - (key - t as i32) / KEY;
        if owner[t] != from {
            continue;
        }
        let s = score(t, mask, owner, from, to, rules);
        if s <= 0 {
            continue;
        }
        if s < key_score {
            h.push((rules.peel_ceiling - s) * KEY + t as i32);
            continue;
        }
        let mut r = 0;
        for (q, off) in RING_OFF.iter().enumerate() {
            let j = at(t, *off);
            if mask[j] != 0 && owner[j] == from {
                r |= 1 << q;
            }
        }
        if SIMPLE[r] == 0 {
            continue;
        }
        owner[t] = to;
        moved += 1;
        for off in NB4 {
            let j = at(t, off);
            if mask[j] != 0 && owner[j] == from && protect[j] == 0 {
                let sj = score(j, mask, owner, from, to, rules);
                if sj > 0 {
                    h.push((rules.peel_ceiling - sj) * KEY + j as i32);
                }
            }
        }
    }
    moved
}
pub(super) fn smooth(
    mask: &[u8],
    tiles: &[usize],
    owner: &mut [u8],
    protect: &[u8],
    rules: &ZoneDefinition,
) {
    for &t in tiles {
        let a = owner[t];
        if protect[t] != 0 {
            continue;
        }
        let (mut b, mut nb) = (0, 0);
        for off in NB4 {
            let j = at(t, off);
            let u = owner[j];
            if mask[j] == 0 || u == a {
                continue;
            }
            let mut count = 0;
            for off in NB4 {
                let k = at(t, off);
                if mask[k] != 0 && owner[k] == u {
                    count += 1;
                }
            }
            if count > nb {
                nb = count;
                b = u;
            }
        }
        if nb < rules.smooth_majority {
            continue;
        }
        let mut r = 0;
        for (q, off) in RING_OFF.iter().enumerate() {
            let j = at(t, *off);
            if mask[j] != 0 && owner[j] == a {
                r |= 1 << q;
            }
        }
        if SIMPLE[r] != 0 {
            owner[t] = b;
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn packed_heap_duplicates_growth_and_left_child_ties() {
        let mut h = Heap::default();
        let mut expected = Vec::new();
        for i in (0..10000).rev() {
            let key = (i % 23) * KEY + (i % 100);
            h.push(key);
            expected.push(key);
        }
        expected.sort();
        for key in expected {
            assert_eq!(h.pop(), key);
        }
        assert!(h.is_empty());
    }
}
