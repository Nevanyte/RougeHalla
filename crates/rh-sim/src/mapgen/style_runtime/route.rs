use super::*;
use crate::mapgen::grid_topology::{descent_path, segment_blocked, walk_field16};
/// Immutable baseline corridors and seeds; only worst-member and private probe change on a query.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteGuard {
    w: usize,
    h: usize,
    mask: Vec<u8>,
    members: Vec<i32>,
    base: Vec<i32>,
    pub(super) corridor: Vec<u8>,
    per_member: Vec<Vec<i32>>,
    seed_tiles: Vec<i32>,
    seed_values: Vec<i32>,
    worst_k: i32,
    cut_off: i32,
    probe: Option<Vec<u8>>,
}
impl RouteGuard {
    pub(super) fn new_admitted(
        state: &State,
        geometry: &Geometry,
        input: &Inputs<'_>,
        cut_off: i32,
    ) -> Self {
        let (w, h) = (state.w, state.h);
        let n = state.tiles.len();
        let mask = &geometry.mask;
        let walk = input.centre_walk;
        let members: Vec<_> = input
            .spawns
            .iter()
            .copied()
            .filter(|&m| {
                usize::try_from(m)
                    .ok()
                    .is_some_and(|i| i < n && mask[i] == 1 && walk.is_some_and(|a| a[i] >= 0))
            })
            .collect();
        let base = members
            .iter()
            .map(|&m| walk.expect("member baseline")[m as usize])
            .collect();
        let mut corridor = vec![0; n];
        let mut per_member = Vec::new();
        let ground: Vec<u8> = if members.is_empty() {
            Vec::new()
        } else {
            (0..n)
                .map(|i| {
                    if mask[i] == 1 {
                        state.tiles[i]
                    } else if walk.expect("baseline")[i] >= 0 {
                        TILE_FLOOR
                    } else {
                        TILE_WALL
                    }
                })
                .collect()
        };
        for &m in &members {
            let raw = descent_path(walk.expect("baseline"), &ground, w, h, m);
            let mut pts = vec![raw[0]];
            let mut a = 0;
            while a + 1 < raw.len() {
                let (ax, ay) = (raw[a] % w as i32, raw[a] / w as i32);
                let mut j = raw.len() - 1;
                while j > a + 1 {
                    let bx = raw[j] % w as i32;
                    if !segment_blocked(
                        &ground,
                        w,
                        h,
                        ax,
                        ay,
                        bx,
                        raw[j] / w as i32,
                        crate::map::MASK_MOVE,
                    ) {
                        break;
                    }
                    j -= 1;
                }
                pts.push(raw[j]);
                a = j;
            }
            let mut mine = Vec::new();
            let mut seen = vec![false; n];
            let mut take = |i: usize| {
                if mask[i] == 1 && !seen[i] {
                    seen[i] = true;
                    mine.push(i as i32);
                    corridor[i] = 1;
                }
            };
            take(pts[0] as usize);
            for s in 0..pts.len() {
                let a = pts[s] as usize;
                let b = pts[if s + 1 < pts.len() { s + 1 } else { s }] as usize;
                let (ax, ay) = ((a % w) as i32, (a / w) as i32);
                let (bx, by) = ((b % w) as i32, (b / w) as i32);
                let steps = (2 * (bx - ax).abs().max((by - ay).abs())).max(1);
                for q in 0..=steps {
                    let x = ax
                        + ((2 * i64::from(bx - ax) * i64::from(q) + i64::from(steps)) as f64
                            / (2.0 * f64::from(steps)))
                        .floor() as i32;
                    let y = ay
                        + ((2 * i64::from(by - ay) * i64::from(q) + i64::from(steps)) as f64
                            / (2.0 * f64::from(steps)))
                        .floor() as i32;
                    take(y as usize * w + x as usize);
                    for dy in -1..=1 {
                        for dx in -1..=1 {
                            if let Some(i) = at(w, h, x + dx, y + dy) {
                                take(i);
                            }
                        }
                    }
                }
            }
            per_member.push(mine);
        }
        let mut list = Vec::new();
        if !members.is_empty() {
            let walk = walk.expect("baseline");
            let mut picked = vec![false; n];
            for i in 0..n {
                if mask[i] != 1 || walk[i] < 0 {
                    continue;
                }
                let (x, y) = ((i % w) as i32, (i / w) as i32);
                for dy in -2..=2 {
                    for dx in -2..=2 {
                        let Some(j) = at(w, h, x + dx, y + dy) else {
                            continue;
                        };
                        if mask[j] == 1 || picked[j] || state.tiles[j] != TILE_FLOOR || walk[j] < 0
                        {
                            continue;
                        }
                        picked[j] = true;
                        list.push(j);
                    }
                }
            }
            list.sort_by_key(|&i| (walk[i], i));
        }
        let seed_tiles = list.iter().map(|&i| i as i32).collect();
        let seed_values = list.iter().map(|&i| walk.expect("baseline")[i]).collect();
        Self {
            w,
            h,
            mask: mask.clone(),
            members,
            base,
            corridor,
            per_member,
            seed_tiles,
            seed_values,
            worst_k: -1,
            cut_off,
            probe: None,
        }
    }
    pub fn members(&self) -> &[i32] {
        &self.members
    }
    pub fn base(&self) -> &[i32] {
        &self.base
    }
    pub fn corridor(&self) -> &[u8] {
        &self.corridor
    }
    pub fn corridor_of(&self, k: i32) -> &[i32] {
        usize::try_from(k)
            .ok()
            .and_then(|k| self.per_member.get(k))
            .map_or(&[], Vec::as_slice)
    }
    pub fn touches(&self, list: &[i32]) -> bool {
        list.iter()
            .any(|&i| usize::try_from(i).ok().and_then(|i| self.corridor.get(i)) == Some(&1))
    }
    pub fn worst_member(&self) -> i32 {
        self.worst_k
    }
    pub(super) fn worst_stretch(&mut self, tiles: &[u8], extra: &[i32]) -> i64 {
        self.worst_k = -1;
        if self.members.is_empty() {
            return 1000;
        }
        let ground = if extra.is_empty() {
            tiles
        } else {
            let p = self.probe.get_or_insert_with(|| vec![0; tiles.len()]);
            p.copy_from_slice(tiles);
            for &i in extra {
                if let Ok(i) = usize::try_from(i) {
                    if let Some(t) = p.get_mut(i) {
                        *t = TILE_WALL;
                    }
                }
            }
            p.as_slice()
        };
        let field = walk_field16(
            ground,
            self.w,
            self.h,
            &self.seed_tiles,
            Some(&self.seed_values),
            Some(&self.mask),
        );
        let mut worst = -1;
        for (k, &m) in self.members.iter().enumerate() {
            let v = field[m as usize];
            if v < 0 {
                self.worst_k = k as i32;
                return i64::from(self.cut_off);
            }
            let s = if self.base[k] > 0 {
                (f64::from(v) * 1000.0 / f64::from(self.base[k])).floor() as i64
            } else {
                1000
            };
            if s > worst {
                worst = s;
                self.worst_k = k as i32;
            }
        }
        worst.max(1000)
    }
}
