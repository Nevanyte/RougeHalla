//! Signature mode (P-LAND-PLAGUE-1-fix): the spawns' walks the bog pools keep. A walk is counted in 4-connected steps
//! over floor, from the zone's spawn to the coliseum (its centre and every gate tile, as the finished map holds them).
//! With every pool tile forbidden, no spawn's walk may be more than `detour` steps longer than with bog allowed.
//!
//! `dry` is the walk field with the pools laid so far forbidden; `band[k]` holds every tile some walk of spawn `k`
//! within its limit crosses (`steps from the spawn + dry <= limit`). A pool clear of every band leaves each spawn a walk
//! within its limit; one that touches a band is checked by a search from that spawn, pruned by `dry` (a pool only
//! lengthens walks, so `dry` never overestimates). Pure and ordered: no draw, no hashing.
use crate::map::TILE_FLOOR;
use crate::mapgen::coliseum::{FixedLayout, CX, CY};
use crate::mapgen::style_runtime::BaseContext;

pub(super) struct Walk {
    w: i32,
    h: i32,
    floor: Vec<bool>,
    starts: Vec<usize>,
    /// The tiles walks may not cross: the pools laid so far.
    pool: Vec<bool>,
    /// Per spawn: its tile and the most steps its walk may take (its walk with bog allowed, plus `detour`).
    spawns: Vec<(usize, i32)>,
    dry: Vec<i32>,
    band: Vec<Vec<bool>>,
    /// Search scratch: the visit stamp and steps per tile, and the queue.
    stamp: Vec<u32>,
    steps: Vec<i32>,
    queue: Vec<usize>,
    now: u32,
}

impl Walk {
    /// The walks on the current tiles, with no pool laid.
    pub(super) fn new(b: &BaseContext<'_>, fixed: &FixedLayout, detour: i32) -> Self {
        let n = b.w * b.h;
        let floor: Vec<bool> = b.tiles.iter().map(|&t| t == TILE_FLOOR).collect();
        let mut starts = Vec::new();
        let gates = fixed.gates.iter().flat_map(|g| g.tiles.iter());
        for (x, y) in std::iter::once((CX, CY)).chain(gates.map(|t| (t.x, t.y))) {
            let i = b.at(x, y);
            if i >= 0 && floor[i as usize] && !starts.contains(&(i as usize)) {
                starts.push(i as usize);
            }
        }
        let mut walk = Walk {
            w: b.w as i32,
            h: b.h as i32,
            floor,
            starts,
            pool: vec![false; n],
            spawns: Vec::new(),
            dry: Vec::new(),
            band: Vec::new(),
            stamp: vec![0; n],
            steps: vec![0; n],
            queue: Vec::new(),
            now: 0,
        };
        walk.dry = walk.field();
        walk.spawns = b
            .spawns
            .iter()
            .filter_map(|&s| usize::try_from(s).ok().filter(|&s| s < n))
            .filter(|&s| walk.dry[s] != i32::MAX)
            .map(|s| (s, walk.dry[s] + detour))
            .collect();
        walk.band = vec![vec![false; n]; walk.spawns.len()];
        walk.refresh(&[]);
        walk
    }

    /// Forbids `tiles` (a pool just laid) and recomputes `dry` and the bands.
    pub(super) fn refresh(&mut self, tiles: &[i32]) {
        for &i in tiles {
            self.pool[i as usize] = true;
        }
        self.dry = self.field();
        for k in 0..self.spawns.len() {
            self.band[k].iter_mut().for_each(|v| *v = false);
            self.search(k, &[], true);
        }
    }

    /// Whether every spawn keeps a walk within its limit once `tiles` are forbidden too.
    pub(super) fn keeps(&mut self, tiles: &[i32]) -> bool {
        for k in 0..self.spawns.len() {
            if tiles.iter().any(|&i| self.band[k][i as usize]) && !self.search(k, tiles, false) {
                return false;
            }
        }
        true
    }

    /// The walk field from the coliseum over floor off the pools (`i32::MAX` where it cannot reach).
    fn field(&mut self) -> Vec<i32> {
        let mut dist = vec![i32::MAX; self.floor.len()];
        self.queue.clear();
        for &s in &self.starts {
            if !self.pool[s] {
                dist[s] = 0;
                self.queue.push(s);
            }
        }
        let mut head = 0;
        while head < self.queue.len() {
            let i = self.queue[head];
            head += 1;
            for j in self.next(i) {
                if self.floor[j] && !self.pool[j] && dist[j] == i32::MAX {
                    dist[j] = dist[i] + 1;
                    self.queue.push(j);
                }
            }
        }
        dist
    }

    /// From spawn `k`, a search over floor off the pools and off `extra`, visiting only tiles on a walk within the
    /// spawn's limit. Marks them in the spawn's band when `mark`; else stops at the first coliseum tile reached.
    fn search(&mut self, k: usize, extra: &[i32], mark: bool) -> bool {
        let (s, limit) = self.spawns[k];
        self.now += 1;
        let now = self.now;
        // Extra tiles are stamped as visited so the search never enters them.
        for &i in extra {
            self.stamp[i as usize] = now;
        }
        if self.stamp[s] == now || self.pool[s] || self.dry[s] > limit {
            return false;
        }
        self.queue.clear();
        self.queue.push(s);
        self.stamp[s] = now;
        self.steps[s] = 0;
        let mut head = 0;
        let mut reached = false;
        while head < self.queue.len() {
            let i = self.queue[head];
            head += 1;
            if mark {
                self.band[k][i] = true;
            }
            if self.dry[i] == 0 {
                reached = true;
                if !mark {
                    break;
                }
            }
            let d = self.steps[i] + 1;
            for j in self.next(i) {
                if self.stamp[j] != now
                    && self.floor[j]
                    && !self.pool[j]
                    && self.dry[j] != i32::MAX
                    && d + self.dry[j] <= limit
                {
                    self.stamp[j] = now;
                    self.steps[j] = d;
                    self.queue.push(j);
                }
            }
        }
        reached
    }

    /// The 4-connected neighbours of `i` on the map, in a fixed order.
    fn next(&self, i: usize) -> impl Iterator<Item = usize> {
        let (w, h) = (self.w, self.h);
        let (x, y) = (i as i32 % w, i as i32 / w);
        [(0, -1), (1, 0), (0, 1), (-1, 0)]
            .into_iter()
            .map(move |(dx, dy)| (x + dx, y + dy))
            .filter(move |&(u, v)| u >= 0 && v >= 0 && u < w && v < h)
            .map(move |(u, v)| (v * w + u) as usize)
    }
}

/// After the barrows (walls laid after the pools can block the dry way round one): while some spawn's walk is past its
/// limit, the bodies of bog that cross a walk within the limit are given back, last laid first, until every walk keeps.
/// `owner[k]` is the body of `pools[k]`. Returns the number of bodies given back.
pub(super) fn give_way(
    b: &BaseContext<'_>,
    fixed: &FixedLayout,
    detour: i32,
    pools: &mut Vec<i32>,
    owner: &mut Vec<u16>,
) -> usize {
    let mut walk = Walk::new(b, fixed, detour);
    let mut given = 0;
    while !walk.keeps(pools) {
        // Every walk within the limit lies in the bands (no pool forbidden), so giving back every body that touches a
        // band of a spawn restores that spawn's walk: the loop ends.
        let crossing = pools
            .iter()
            .zip(owner.iter())
            .filter(|&(&i, _)| walk.band.iter().any(|band| band[i as usize]))
            .map(|(_, &o)| o)
            .max();
        let Some(last) = crossing else { break };
        let (p, o) = pools
            .iter()
            .zip(owner.iter())
            .filter(|&(_, &o)| o != last)
            .map(|(&i, &o)| (i, o))
            .unzip();
        (*pools, *owner) = (p, o);
        given += 1;
    }
    given
}
