//! Actual whole-wall stage-4 transactions. No template search/callback selection or finished-map claim.
mod geometry;
mod rules;
use crate::map::{TILE_FLOOR, TILE_WALL};
use crate::mapdata::{FeatureJob, FeatureKind, MapFeature, TilePt, TileRect, Zone};
use crate::mapgen::attempt::StyleCamp;
use crate::mapgen::grid_topology::{RING_DX, RING_DY, SIMPLE};
pub use geometry::{chamfer, CampInfo, FloatTilePoint, ZoneGeometry, ZoneInfo};
pub use rules::{default_definition, visit_content, LandmarkDefinition, DEFAULT_DEFINITION};

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Scratch {
    mark: Vec<i32>,
    qa: Vec<i32>,
    qb: Vec<i32>,
    epoch: i64,
}
impl Scratch {
    fn new(n: usize) -> Self {
        Self {
            mark: vec![0; n],
            qa: vec![0; n],
            qb: vec![0; n],
            epoch: 0,
        }
    }
    fn stamp(&mut self) -> i64 {
        self.epoch = self.epoch.checked_add(1).expect("scratch epoch");
        self.epoch
    }
}
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stage4State {
    pub w: usize,
    pub h: usize,
    pub tiles: Vec<u8>,
    pub terrain: Vec<u8>,
    pub features: Vec<MapFeature>,
    pub feature_owner: Vec<u16>,
    pub wrote: Vec<u8>,
    pub scratch: Scratch,
}
impl Stage4State {
    pub fn new(
        w: usize,
        h: usize,
        tiles: Vec<u8>,
        features: Vec<MapFeature>,
        feature_owner: Vec<u16>,
    ) -> Self {
        let n = w.checked_mul(h).expect("grid area");
        assert!(
            w > 0
                && h > 0
                && n <= i32::MAX as usize
                && tiles.len() == n
                && feature_owner.len() == n
        );
        assert!(tiles.iter().all(|&v| v == TILE_FLOOR || v == TILE_WALL));
        assert!(feature_owner
            .iter()
            .all(|&o| usize::from(o) <= features.len()));
        Self {
            w,
            h,
            tiles,
            terrain: vec![0; n],
            features,
            feature_owner,
            wrote: vec![0; n],
            scratch: Scratch::new(n),
        }
    }
}
/// Restricted source FeatureSpec: kind=landmark, mode=whole, every blocker=wall.
/// Optional floor preserves the source's distinction between absent and empty (scratch stamps).
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LandmarkSpec {
    pub variant: String,
    pub jobs: Vec<FeatureJob>,
    pub anchor: [i32; 2],
    pub params: Option<Vec<i32>>,
    pub blocks: Vec<i32>,
    pub floor: Option<Vec<i32>>,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PlacedFeature {
    pub id: usize,
    pub written: Vec<i32>,
    pub refused: usize,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Counters {
    pub walls: usize,
    pub lows: usize,
    pub refused: usize,
    pub join_used: u32,
    pub join_left: u32,
    pub features_added: usize,
}

pub struct LandmarkRuntime<'a> {
    state: &'a mut Stage4State,
    geometry: &'a ZoneGeometry,
    hard: &'a [u8],
    territory: Option<&'a [u8]>,
    rules: LandmarkDefinition,
    counters: Counters,
    reserved: Vec<u8>,
}
impl<'a> LandmarkRuntime<'a> {
    /// `hard` is the original transaction mask, not a callback's planning-only hard/open override.
    pub fn new(
        state: &'a mut Stage4State,
        geometry: &'a ZoneGeometry,
        hard: &'a [u8],
        territory: Option<&'a [u8]>,
        rules: &LandmarkDefinition,
    ) -> Self {
        let n = state.tiles.len();
        assert!(
            state.w > 0
                && state.h > 0
                && state.w.checked_mul(state.h) == Some(n)
                && n <= i32::MAX as usize
        );
        assert!(geometry.w == state.w && geometry.h == state.h);
        assert!(state
            .feature_owner
            .iter()
            .all(|&o| usize::from(o) <= state.features.len()));
        assert!(
            geometry.mask.len() == n
                && geometry.edge_dist.len() == n
                && hard.len() == n
                && territory.is_none_or(|t| t.len() == n)
        );
        assert!(
            state.terrain.iter().all(|&v| v == 0)
                && state
                    .tiles
                    .iter()
                    .all(|&v| v == TILE_FLOOR || v == TILE_WALL)
        );
        assert!(
            state.terrain.len() == n
                && state.wrote.len() == n
                && state.feature_owner.len() == n
                && state.scratch.mark.len() == n
                && state.scratch.qa.len() == n
                && state.scratch.qb.len() == n
        );
        assert!(
            rules.footprint_percent.is_finite()
                && rules.footprint_percent >= 0.0
                && rules.rim_tiles.is_finite()
                && rules.rim_tiles >= 0.0
        );
        Self {
            state,
            geometry,
            hard,
            territory,
            rules: *rules,
            counters: Counters {
                walls: 0,
                lows: 0,
                refused: 0,
                join_used: 0,
                join_left: rules.join_checks,
                features_added: 0,
            },
            reserved: vec![0; n],
        }
    }
    pub fn state(&self) -> &Stage4State {
        self.state
    }
    /// Immutable zone inputs for template planning; no guard or transaction state changes.
    pub fn geometry(&self) -> &ZoneGeometry {
        self.geometry
    }
    /// The transaction's original mask. Planning overlays must remain separate from this mask.
    pub fn original_hard(&self) -> &[u8] {
        self.hard
    }
    pub fn counters(&self) -> Counters {
        self.counters
    }
    pub fn reserved(&self) -> &[u8] {
        &self.reserved
    }
    pub fn reserve(&mut self, i: i32) {
        if let Some(i) = self.index(i) {
            self.reserved[i] = 1;
        }
    }
    pub fn is_reserved(&self, i: i32) -> bool {
        self.index(i).is_some_and(|i| self.reserved[i] == 1)
    }
    pub fn is_owned(&self, i: i32) -> bool {
        self.index(i)
            .is_some_and(|i| self.state.feature_owner[i] != 0)
    }
    pub fn zone_features(&self) -> impl Iterator<Item = &MapFeature> {
        self.state
            .features
            .iter()
            .filter(|f| f.zone == self.geometry.info.faction)
    }
    fn index(&self, i: i32) -> Option<usize> {
        usize::try_from(i)
            .ok()
            .filter(|&i| i < self.state.tiles.len())
    }
    pub fn open(&self, i: i32) -> bool {
        let Some(i) = self.index(i) else {
            return false;
        };
        let s = &self.state;
        self.geometry.mask[i] != 0
            && self.hard[i] == 0
            && s.tiles[i] == TILE_FLOOR
            && self.reserved[i] == 0
            && f64::from(self.geometry.edge_dist[i]) >= self.rules.rim_tiles * 3.0
            && s.feature_owner[i] == 0
            && i % s.w > 0
            && i / s.w > 0
            && i % s.w < s.w - 1
            && i / s.w < s.h - 1
    }
    /// Stateful: fallback joins spend budget even if a subsequent blocker or whole feature fails.
    pub fn can_block_wall(&mut self, i: i32) -> bool {
        if !self.open(i) {
            return false;
        }
        let i = i as usize;
        // 100 is the source's percentage/cost unit, not another geometry rule.
        if 100.0 * self.counters.walls as f64 + 100.0
            > self.rules.footprint_percent * self.geometry.info.painted as f64
        {
            return false;
        }
        let tv = self.territory.map_or(0, |t| t[i]);
        let (mut m, mut mt) = (0usize, 0usize);
        for q in 0..8 {
            let j = (i as i64 + i64::from(RING_DY[q]) * self.state.w as i64 + i64::from(RING_DX[q]))
                as usize;
            if self.state.tiles[j] != TILE_FLOOR {
                continue;
            }
            if self.geometry.mask[j] == 0 {
                return false;
            }
            m |= 1 << q;
            if tv != 0 && self.territory.is_some_and(|t| t[j] == tv) {
                mt |= 1 << q;
            }
        }
        if SIMPLE[m] == 0 {
            if !self.spend_join() {
                return false;
            }
            if !self.joined_without(i, false, 1) {
                return false;
            }
        }
        if tv != 0 && SIMPLE[mt] == 0 {
            if !self.spend_join() {
                return false;
            }
            if !self.joined_without(i, true, tv) {
                return false;
            }
        }
        true
    }
    fn spend_join(&mut self) -> bool {
        if self.counters.join_left == 0 {
            return false;
        }
        self.counters.join_left -= 1;
        self.counters.join_used += 1;
        true
    }
    fn scope(&self, i: usize, territory: bool) -> u8 {
        if territory {
            self.territory.expect("territory scope")[i]
        } else {
            self.geometry.mask[i]
        }
    }
    fn neighbors(&self, i: usize) -> [Option<usize>; 4] {
        let (w, h) = (self.state.w, self.state.h);
        let (x, y) = (i % w, i / w);
        [
            if y > 0 { Some(i - w) } else { None },
            if x + 1 < w { Some(i + 1) } else { None },
            if y + 1 < h { Some(i + w) } else { None },
            if x > 0 { Some(i - 1) } else { None },
        ]
    }
    fn joined_without(&mut self, i: usize, territory: bool, value: u8) -> bool {
        let ends: Vec<usize> = self
            .neighbors(i)
            .into_iter()
            .flatten()
            .filter(|&j| self.state.tiles[j] == TILE_FLOOR && self.scope(j, territory) == value)
            .collect();
        if ends.len() <= 1 {
            return true;
        }
        let saved = self.state.tiles[i];
        self.state.tiles[i] = TILE_WALL;
        let mut ok = true;
        for &u in &ends[1..] {
            if !self.joins(ends[0], u, territory, value) {
                ok = false;
                break;
            }
        }
        self.state.tiles[i] = saved;
        ok
    }
    fn joins(&mut self, s: usize, u: usize, territory: bool, value: u8) -> bool {
        let mark_a = self.state.scratch.stamp();
        let mark_b = self.state.scratch.stamp();
        let (mut head_a, mut tail_a, mut head_b, mut tail_b) = (0, 1, 0, 1);
        self.state.scratch.qa[0] = s as i32;
        self.state.scratch.mark[s] = mark_a as i32;
        self.state.scratch.qb[0] = u as i32;
        self.state.scratch.mark[u] = mark_b as i32;
        while head_a < tail_a && head_b < tail_b {
            let i = self.state.scratch.qa[head_a] as usize;
            head_a += 1;
            for j in self.neighbors(i).into_iter().flatten() {
                if self.state.tiles[j] != TILE_FLOOR || self.scope(j, territory) != value {
                    continue;
                }
                let m = i64::from(self.state.scratch.mark[j]);
                if m == mark_b {
                    return true;
                }
                if m != mark_a {
                    self.state.scratch.mark[j] = mark_a as i32;
                    self.state.scratch.qa[tail_a] = j as i32;
                    tail_a += 1;
                }
            }
            let i = self.state.scratch.qb[head_b] as usize;
            head_b += 1;
            for j in self.neighbors(i).into_iter().flatten() {
                if self.state.tiles[j] != TILE_FLOOR || self.scope(j, territory) != value {
                    continue;
                }
                let m = i64::from(self.state.scratch.mark[j]);
                if m == mark_a {
                    return true;
                }
                if m != mark_b {
                    self.state.scratch.mark[j] = mark_b as i32;
                    self.state.scratch.qb[tail_b] = j as i32;
                    tail_b += 1;
                }
            }
        }
        false
    }
    pub fn place_whole(&mut self, spec: &LandmarkSpec) -> Option<PlacedFeature> {
        let walls_before = self.counters.walls;
        let mut log = Vec::new();
        let mut ok = true;
        for &t in &spec.blocks {
            if !self.can_block_wall(t) {
                self.counters.refused += 1;
                ok = false;
                break;
            }
            let i = t as usize;
            log.push((i, self.state.tiles[i], self.state.wrote[i]));
            self.state.tiles[i] = TILE_WALL;
            self.state.terrain[i] = 0;
            self.state.wrote[i] = 1;
            self.counters.walls += 1;
        }
        let mut written = Vec::new();
        let mut floor = Vec::new();
        if ok {
            let stamp = self.state.scratch.stamp();
            for &t in &spec.blocks {
                let i = t as usize;
                if self.state.tiles[i] == TILE_FLOOR
                    || i64::from(self.state.scratch.mark[i]) == stamp
                {
                    continue;
                }
                self.state.scratch.mark[i] = stamp as i32;
                written.push(t);
            }
            if let Some(list) = &spec.floor {
                let stamp = self.state.scratch.stamp();
                for &t in list {
                    let Some(i) = self.index(t) else {
                        continue;
                    };
                    if self.geometry.mask[i] == 0
                        || self.state.tiles[i] != TILE_FLOOR
                        || self.state.feature_owner[i] != 0
                        || i64::from(self.state.scratch.mark[i]) == stamp
                    {
                        continue;
                    }
                    self.state.scratch.mark[i] = stamp as i32;
                    floor.push(t);
                }
            }
        }
        if !ok || written.len() + floor.len() == 0 {
            for &(i, t, wrote) in log.iter().rev() {
                self.state.tiles[i] = t;
                self.state.terrain[i] = 0;
                self.state.wrote[i] = wrote;
            }
            self.counters.walls = walls_before;
            return None;
        }
        let id = self.state.features.len();
        let (mut x0, mut y0, mut x1, mut y1) = (self.state.w, self.state.h, 0, 0);
        for &t in written.iter().chain(&floor) {
            let i = t as usize;
            self.state.feature_owner[i] = (id + 1) as u16;
            let (x, y) = (i % self.state.w, i / self.state.w);
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
        self.state.features.push(MapFeature {
            kind: FeatureKind::Landmark,
            variant: spec.variant.clone(),
            zone: self.geometry.info.faction,
            jobs: spec.jobs.clone(),
            ax: spec.anchor[0],
            ay: spec.anchor[1],
            p: spec.params.clone().unwrap_or_default(),
            bbox: TileRect {
                x: x0 as i32,
                y: y0 as i32,
                w: (x1 - x0 + 1) as u32,
                h: (y1 - y0 + 1) as u32,
            },
            tiles: (written.len() + floor.len()) as u32,
        });
        self.counters.features_added += 1;
        Some(PlacedFeature {
            id,
            refused: spec.blocks.len() - written.len(),
            written,
        })
    }
}
#[cfg(test)]
mod tests;
