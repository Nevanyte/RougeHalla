//! Stage-six guarded operations and feature transactions. The five faction callbacks are separate.
mod contexts;
mod rules;
pub use contexts::{BaseContext, PropContext, ShapeContext, SurfaceContext};
mod connectivity;
mod route;
mod transactions;
use crate::map::{TILE_FLOOR, TILE_LOW, TILE_WALL};
use crate::mapdata::{FeatureJob, FeatureKind, MapFeature, MapProp, TileRect, Zone};
use crate::mapgen::attempt::StyleCamp;
use crate::mapgen::grid_topology::{RING_DX, RING_DY, SIMPLE};
use crate::mapgen::landmarks::recipe_support::Noise;
use crate::mapgen::landmarks::runtime::ZoneGeometry;
use crate::mapgen::terrain_gate::{PropKind, TerrainKind};
use crate::rng::{hash_seed, Mulberry32};
pub use connectivity::{floor_components, repair_connectivity};
pub use route::RouteGuard;
pub use rules::{default_definition, visit_content, Definition, DEFAULT_DEFINITION};

/// Admitted geometry retains dimensions, so equal-area transposed grids cannot be confused.
#[derive(Clone, Debug)]
pub struct Geometry {
    w: usize,
    h: usize,
    inner: ZoneGeometry,
}
impl std::ops::Deref for Geometry {
    type Target = ZoneGeometry;
    fn deref(&self) -> &ZoneGeometry {
        &self.inner
    }
}
impl Geometry {
    pub fn new(
        index: u8,
        faction: Zone,
        zone: &[u8],
        tiles: &[u8],
        w: usize,
        h: usize,
        camps: &[StyleCamp],
    ) -> Result<Self, Error> {
        let n = grid_size(w, h)?;
        if zone.len() != n
            || tiles.len() != n
            || index == 0
            || camps.iter().any(|c| c.site >= n || !c.r.is_finite())
        {
            return Err(Error::Layer);
        }
        Ok(Self {
            w,
            h,
            inner: ZoneGeometry::new(index, faction, zone, tiles, w, h, camps),
        })
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Dimensions,
    Layer,
    Ownership,
    Definition,
    Metadata,
    Feature,
    Capacity,
    Route,
}
/// Index packing in source route seeds uses 21 bits; depth uses signed 16 bits.
pub(crate) const MAX_CELLS: usize = 2_097_152;
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Scratch {
    mark: Vec<i32>,
    qa: Vec<i32>,
    qb: Vec<i32>,
    depth: Vec<i16>,
    epoch: i64,
}
impl Scratch {
    fn new(n: usize) -> Self {
        Self {
            mark: vec![0; n],
            qa: vec![0; n],
            qb: vec![0; n],
            depth: vec![0; n],
            epoch: 0,
        }
    }
    fn stamp(&mut self) -> i64 {
        self.epoch += 1;
        self.epoch
    }
}
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    w: usize,
    h: usize,
    tiles: Vec<u8>,
    terrain: Vec<u8>,
    props: Vec<MapProp>,
    features: Vec<MapFeature>,
    feature_owner: Vec<u16>,
    wrote: Vec<u8>,
    scratch: Scratch,
}
impl State {
    pub fn new(
        w: usize,
        h: usize,
        tiles: Vec<u8>,
        terrain: Vec<u8>,
        props: Vec<MapProp>,
        features: Vec<MapFeature>,
        feature_owner: Vec<u16>,
    ) -> Result<Self, Error> {
        let n = grid_size(w, h)?;
        if tiles.len() != n
            || terrain.len() != n
            || feature_owner.len() != n
            || tiles
                .iter()
                .any(|t| ![TILE_FLOOR, TILE_WALL, TILE_LOW].contains(t))
        {
            return Err(Error::Layer);
        }
        if features.len() > u16::MAX as usize
            || feature_owner
                .iter()
                .any(|&o| usize::from(o) > features.len())
        {
            return Err(Error::Ownership);
        }
        if props.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
            return Err(Error::Metadata);
        }
        Ok(Self {
            w,
            h,
            tiles,
            terrain,
            props,
            features,
            feature_owner,
            wrote: vec![0; n],
            scratch: Scratch::new(n),
        })
    }
    pub fn w(&self) -> usize {
        self.w
    }
    pub fn h(&self) -> usize {
        self.h
    }
    pub fn tiles(&self) -> &[u8] {
        &self.tiles
    }
    pub fn terrain(&self) -> &[u8] {
        &self.terrain
    }
    pub fn props(&self) -> &[MapProp] {
        &self.props
    }
    pub fn features(&self) -> &[MapFeature] {
        &self.features
    }
    pub fn feature_owner(&self) -> &[u16] {
        &self.feature_owner
    }
    pub fn wrote(&self) -> &[u8] {
        &self.wrote
    }
    /// Return authoritative layers after the complete style pass; the scratch/wrote are pass-local.
    pub fn into_layers(self) -> Layers {
        Layers {
            tiles: self.tiles,
            terrain: self.terrain,
            props: self.props,
            features: self.features,
            feature_owner: self.feature_owner,
        }
    }
}
/// Durable style outputs. Pass-local scratch and wrote/reserved masks are intentionally discarded.
#[derive(Clone, Debug, PartialEq)]
pub struct Layers {
    pub tiles: Vec<u8>,
    pub terrain: Vec<u8>,
    pub props: Vec<MapProp>,
    pub features: Vec<MapFeature>,
    pub feature_owner: Vec<u16>,
}
fn grid_size(w: usize, h: usize) -> Result<usize, Error> {
    w.checked_mul(h)
        .filter(|&n| w > 0 && h > 0 && n <= MAX_CELLS)
        .ok_or(Error::Dimensions)
}
/// Whole-pass noBlock precedence: any protect byte forces 1; otherwise preserve the caller's byte.
pub fn no_block(protect: &[u8], extra: Option<&[u8]>) -> Result<Vec<u8>, Error> {
    if extra.is_some_and(|a| a.len() != protect.len()) {
        return Err(Error::Layer);
    }
    Ok(protect
        .iter()
        .enumerate()
        .map(|(i, &p)| if p != 0 { 1 } else { extra.map_or(0, |a| a[i]) })
        .collect())
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BlockKind {
    Wall,
    Lava,
    Fence,
    Crevasse,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SurfaceKind {
    Ember,
    Bog,
    Ice,
    Light,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Whole,
    Trim,
    Groups,
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeatureSpec {
    pub kind: FeatureKind,
    pub variant: Option<String>,
    pub jobs: Vec<FeatureJob>,
    pub anchor: [i32; 2],
    pub params: Option<Vec<i32>>,
    pub blocks: Vec<(i32, BlockKind)>,
    pub groups: Option<Vec<i32>>,
    pub floor: Option<Vec<i32>>,
    pub mode: Mode,
    pub min_piece: Option<u32>,
    pub min_share_permille: Option<u32>,
    pub min_groups: Option<u32>,
}
pub use crate::mapgen::landmarks::runtime::PlacedFeature;
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Counters {
    pub walls: i64,
    pub lows: i64,
    pub refused: u64,
    pub join_used: u32,
    pub join_left: u32,
    pub surfaced: u64,
    pub props_added: u64,
    pub features_added: u64,
}
/// Borrowed terrain and prop metadata from the sole shared definitions, including each prop's home.
#[derive(Clone, Copy)]
pub struct Metadata<'a> {
    pub terrain: &'a [TerrainKind],
    pub props: &'a [PropKind<'a>],
    pub tile_size: f64,
}
#[derive(Clone, Copy)]
struct Kinds {
    none: u8,
    lava: u8,
    fence: u8,
    crevasse: u8,
    ember: u8,
    bog: u8,
    ice: u8,
    light: u8,
}
impl Kinds {
    fn new(meta: Metadata<'_>) -> Result<Self, Error> {
        if meta.terrain.len() > 256
            || meta.props.len() > u16::MAX as usize + 1
            || !meta.tile_size.is_finite()
            || meta.tile_size <= 0.0
            || meta.tile_size > 1e9
            || meta
                .props
                .iter()
                .any(|p| ![TILE_FLOOR, TILE_LOW, TILE_WALL].contains(&p.on))
        {
            return Err(Error::Metadata);
        }
        let get = |key: &str, tile: Option<u8>| -> Result<u8, Error> {
            let found: Vec<_> = meta
                .terrain
                .iter()
                .enumerate()
                .filter(|(_, t)| t.key == key)
                .collect();
            if found.len() != 1 || found[0].1.tile != tile {
                return Err(Error::Metadata);
            }
            Ok(found[0].0 as u8)
        };
        let out = Self {
            none: get("none", None)?,
            lava: get("lava", Some(TILE_LOW))?,
            fence: get("fence", Some(TILE_LOW))?,
            crevasse: get("crevasse", Some(TILE_LOW))?,
            ember: get("ember", Some(TILE_FLOOR))?,
            bog: get("bog", Some(TILE_FLOOR))?,
            ice: get("ice", Some(TILE_FLOOR))?,
            light: get("light", Some(TILE_FLOOR))?,
        };
        // Source context/repair use fixed terrain IDs, not validateTerrain's table overrides.
        if [
            out.none,
            out.lava,
            out.fence,
            out.crevasse,
            out.ember,
            out.bog,
            out.ice,
            out.light,
        ] != [0, 1, 2, 3, 4, 5, 6, 7]
        {
            return Err(Error::Metadata);
        }
        Ok(out)
    }
    fn block(self, k: BlockKind) -> u8 {
        match k {
            BlockKind::Wall => self.none,
            BlockKind::Lava => self.lava,
            BlockKind::Fence => self.fence,
            BlockKind::Crevasse => self.crevasse,
        }
    }
    fn surface(self, k: SurfaceKind) -> u8 {
        match k {
            SurfaceKind::Ember => self.ember,
            SurfaceKind::Bog => self.bog,
            SurfaceKind::Ice => self.ice,
            SurfaceKind::Light => self.light,
        }
    }
}
pub struct Inputs<'a> {
    pub geometry: &'a Geometry,
    pub hard: &'a [u8],
    pub no_block: &'a [u8],
    pub no_prop: &'a [u8],
    pub territory: Option<&'a [u8]>,
    pub spawns: &'a [i32],
    pub centre_walk: Option<&'a [i32]>,
    pub seed: i64,
    pub attempt: u64,
}
#[derive(Clone, Copy, Debug)]
pub enum Phase {
    Shape,
    Decor,
    Surface,
}
#[derive(Clone, Debug)]
pub struct Streams {
    pub rng: Mulberry32,
    pub noise: Noise,
}
#[derive(Clone, Copy, Debug)]
struct Write {
    tile: usize,
    class: u8,
    kind: u8,
    wrote: u8,
}
#[derive(Clone, Copy)]
struct TxMark {
    len: usize,
    walls: i64,
    lows: i64,
}
pub struct Runtime<'a> {
    state: &'a mut State,
    input: Inputs<'a>,
    metadata: Metadata<'a>,
    rules: Definition,
    kinds: Kinds,
    counters: Counters,
    reserved: Vec<u8>,
    guard: Option<RouteGuard>,
    tx_on: bool,
    log: Vec<Write>,
}
impl<'a> Runtime<'a> {
    pub fn new(
        state: &'a mut State,
        input: Inputs<'a>,
        metadata: Metadata<'a>,
        rules: &Definition,
    ) -> Result<Self, Error> {
        rules.validate()?;
        let kinds = Kinds::new(metadata)?;
        let n = state.tiles.len();
        if input.geometry.w != state.w || input.geometry.h != state.h {
            return Err(Error::Dimensions);
        }
        if [
            input.hard.len(),
            input.no_block.len(),
            input.no_prop.len(),
            input.geometry.mask.len(),
            input.geometry.edge_dist.len(),
        ]
        .iter()
        .any(|&l| l != n)
            || input.territory.is_some_and(|a| a.len() != n)
            || input.centre_walk.is_some_and(|a| a.len() != n)
        {
            return Err(Error::Layer);
        }
        if input.geometry.info.painted != input.geometry.mask.iter().filter(|&&m| m != 0).count()
            || input.geometry.mask.iter().any(|&m| m > 1)
            || state
                .terrain
                .iter()
                .any(|&t| usize::from(t) >= metadata.terrain.len())
        {
            return Err(Error::Layer);
        }
        if input.seed.unsigned_abs() > 9_007_199_254_740_991
            || input.attempt > 9_007_199_254_740_991
            || input.geometry.info.index == 0
        {
            return Err(Error::Metadata);
        }
        // Bound the shared walk helper's signed costs and 21-bit packed keys before any mutation.
        if input.centre_walk.is_some_and(|a| {
            a.iter()
                .any(|&v| v < -1 || i64::from(v) + 11 * n as i64 >= 1 << 30)
        }) {
            return Err(Error::Route);
        }
        Ok(Self {
            state,
            input,
            metadata,
            rules: *rules,
            kinds,
            counters: Counters {
                walls: 0,
                lows: 0,
                refused: 0,
                join_used: 0,
                join_left: rules.join_checks,
                surfaced: 0,
                props_added: 0,
                features_added: 0,
            },
            reserved: vec![0; n],
            guard: None,
            tx_on: false,
            log: Vec::new(),
        })
    }
    pub fn state(&self) -> &State {
        self.state
    }
    pub fn geometry(&self) -> &Geometry {
        self.input.geometry
    }
    pub fn original_hard(&self) -> &[u8] {
        self.input.hard
    }
    pub fn no_block(&self) -> &[u8] {
        self.input.no_block
    }
    pub fn territory(&self) -> Option<&[u8]> {
        self.input.territory
    }
    pub fn spawns(&self) -> &[i32] {
        self.input.spawns
    }
    pub fn centre_walk(&self) -> Option<&[i32]> {
        self.input.centre_walk
    }
    pub fn counters(&self) -> Counters {
        self.counters
    }
    pub fn reserved(&self) -> &[u8] {
        &self.reserved
    }
    pub fn definition(&self) -> &Definition {
        &self.rules
    }
    pub fn streams(&self, phase: Phase) -> Streams {
        let stream = match phase {
            Phase::Shape => self.rules.shape_stream,
            Phase::Decor => self.rules.decor_stream,
            Phase::Surface => self.rules.surface_stream,
        };
        let seed = self.input.seed as u32;
        let attempt = self.input.attempt as u32;
        let z = u32::from(self.input.geometry.info.index);
        Streams {
            rng: Mulberry32::new(hash_seed(seed, attempt, z, stream)),
            noise: Noise {
                stream_seed: hash_seed(seed, attempt, z, stream + self.rules.noise_stream_offset),
            },
        }
    }
    pub fn at(&self, x: i32, y: i32) -> i32 {
        at(self.state.w, self.state.h, x, y).map_or(-1, |i| i as i32)
    }
    fn index(&self, i: i32) -> Option<usize> {
        usize::try_from(i)
            .ok()
            .filter(|&i| i < self.state.tiles.len())
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
    /// Source Sanctum updates the hall's pier count through the returned feature view.
    pub fn set_hall_pier_count(&mut self, id: usize, count: u32) -> Result<(), Error> {
        if self.input.geometry.info.faction != Zone::Holy
            || count as usize > self.state.tiles.len() / 9
        {
            return Err(Error::Feature);
        }
        let feature = self.state.features.get_mut(id).ok_or(Error::Feature)?;
        if feature.zone != Zone::Holy || feature.kind != FeatureKind::Hall {
            return Err(Error::Feature);
        }
        let p = feature.p.get_mut(3).ok_or(Error::Feature)?;
        *p = count as i32;
        Ok(())
    }
    pub fn zone_features(&self) -> impl Iterator<Item = &MapFeature> {
        self.state
            .features
            .iter()
            .filter(|f| f.zone == self.input.geometry.info.faction)
    }
    pub fn open(&self, i: i32) -> bool {
        let Some(i) = self.index(i) else {
            return false;
        };
        let s = &self.state;
        self.input.geometry.mask[i] != 0
            && self.input.hard[i] == 0
            && self.input.no_block[i] == 0
            && s.tiles[i] == TILE_FLOOR
            && self.reserved[i] == 0
            && f64::from(self.input.geometry.edge_dist[i]) >= self.rules.rim_tiles * 3.0
            && s.feature_owner[i] == 0
            && i % s.w > 0
            && i / s.w > 0
            && i % s.w < s.w - 1
            && i / s.w < s.h - 1
    }
    fn footprint(&self) -> f64 {
        f64::from(self.rules.wall_cost) * self.counters.walls as f64
            + f64::from(self.rules.low_cost) * self.counters.lows as f64
    }
    pub fn can_block(&mut self, t: i32, kind: BlockKind) -> bool {
        let Some(i) = self.index(t) else {
            return false;
        };
        let s = &self.state;
        if self.input.geometry.mask[i] == 0 || self.input.hard[i] != 0 || s.feature_owner[i] != 0 {
            return false;
        }
        let limit = self.rules.footprint_percent * self.input.geometry.info.painted as f64;
        if s.tiles[i] == TILE_LOW {
            return kind == BlockKind::Wall
                && (s.wrote[i] == 1
                    || self.footprint() + f64::from(self.rules.wall_cost) <= limit);
        }
        if !self.open(t) {
            return false;
        }
        let cost = if kind == BlockKind::Wall {
            self.rules.wall_cost
        } else {
            self.rules.low_cost
        };
        if self.footprint() + f64::from(cost) > limit {
            return false;
        }
        let (x, y) = ((i % s.w) as i32, (i / s.w) as i32);
        for q in 0..8 {
            if at(s.w, s.h, x + RING_DX[q], y + RING_DY[q])
                .is_some_and(|j| s.terrain[j] == self.kinds.ice)
            {
                return false;
            }
        }
        if kind == BlockKind::Fence && !self.detour_ok(i, self.rules.fence_detour, 3) {
            return false;
        }
        if !self.low_support_ok(x, y, i, kind != BlockKind::Wall) {
            return false;
        }
        let tv = self.input.territory.map_or(0, |a| a[i]);
        let (mut m, mut mt) = (0usize, 0usize);
        for q in 0..8 {
            let j = (i as i64 + i64::from(RING_DY[q]) * self.state.w as i64 + i64::from(RING_DX[q]))
                as usize;
            if self.state.tiles[j] != TILE_FLOOR {
                continue;
            }
            if self.input.geometry.mask[j] == 0 {
                return false;
            }
            m |= 1 << q;
            if tv != 0 && self.input.territory.is_some_and(|a| a[j] == tv) {
                mt |= 1 << q;
            }
        }
        if SIMPLE[m] == 0 && (!self.spend_join() || !self.joined_without(i, false, 1)) {
            return false;
        }
        if tv != 0 && SIMPLE[mt] == 0 && (!self.spend_join() || !self.joined_without(i, true, tv)) {
            return false;
        }
        true
    }
    pub fn block(&mut self, i: i32, kind: BlockKind) -> bool {
        if !self.can_block(i, kind) {
            self.counters.refused += 1;
            return false;
        }
        let i = i as usize;
        self.log_write(i);
        if self.state.tiles[i] == TILE_LOW {
            self.state.tiles[i] = TILE_WALL;
            if self.state.wrote[i] != 0 {
                self.counters.lows -= 1;
            }
            self.counters.walls += 1;
        } else if kind == BlockKind::Wall {
            self.state.tiles[i] = TILE_WALL;
            self.state.terrain[i] = self.kinds.none;
            self.counters.walls += 1;
        } else {
            self.state.tiles[i] = TILE_LOW;
            self.state.terrain[i] = self.kinds.block(kind);
            self.counters.lows += 1;
        }
        self.state.wrote[i] = 1;
        true
    }
    pub fn release(&mut self, i: i32) -> bool {
        let Some(i) = self.index(i) else {
            return false;
        };
        if self.state.wrote[i] == 0 || self.state.tiles[i] != TILE_LOW {
            return false;
        }
        self.log_write(i);
        self.state.tiles[i] = TILE_FLOOR;
        self.state.terrain[i] = self.kinds.none;
        self.state.wrote[i] = 0;
        self.counters.lows -= 1;
        true
    }
    fn floor_near(&self, x: i32, y: i32, except: usize) -> bool {
        DIAMOND2.iter().any(|&(dx, dy)| {
            at(self.state.w, self.state.h, x + dx, y + dy)
                .is_some_and(|j| j != except && self.state.tiles[j] == TILE_FLOOR)
        })
    }
    fn low_support_ok(&self, x: i32, y: i32, i: usize, low: bool) -> bool {
        if low && !self.floor_near(x, y, i) {
            return false;
        }
        for &(dx, dy) in &DIAMOND2 {
            if let Some(j) = at(self.state.w, self.state.h, x + dx, y + dy) {
                if self.state.tiles[j] == TILE_LOW
                    && !self.floor_near((j % self.state.w) as i32, (j / self.state.w) as i32, i)
                {
                    return false;
                }
            }
        }
        true
    }
    pub fn fence_detour_ok(&mut self, i: i32) -> bool {
        self.index(i)
            .is_none_or(|i| self.detour_ok(i, self.rules.fence_detour, 3))
    }
    fn detour_ok(&mut self, i: usize, cap: u16, reach: usize) -> bool {
        let (w, h) = (self.state.w, self.state.h);
        let (x, y) = (i % w, i / w);
        for step in [w, 1] {
            for k in 1..=reach {
                if if step == 1 {
                    x < k || x + k >= w
                } else {
                    y < k || y + k >= h
                } {
                    break;
                }
                let (a, b) = (i - k * step, i + k * step);
                if self.state.tiles[a] != TILE_FLOOR
                    || self.state.tiles[b] != TILE_FLOOR
                    || self.input.geometry.mask[a] == 0
                    || self.input.geometry.mask[b] == 0
                {
                    break;
                }
                if !self.reaches_within(a, b, i, 2 * k + usize::from(cap)) {
                    return false;
                }
            }
        }
        true
    }
    fn reaches_within(&mut self, a: usize, b: usize, except: usize, limit: usize) -> bool {
        let stamp = self.state.scratch.stamp();
        let (mut head, mut tail) = (0, 1);
        self.state.scratch.qa[0] = a as i32;
        self.state.scratch.mark[a] = stamp as i32;
        self.state.scratch.depth[a] = 0;
        while head < tail {
            let cur = self.state.scratch.qa[head] as usize;
            head += 1;
            if cur == b {
                return true;
            }
            if usize::try_from(self.state.scratch.depth[cur]).unwrap_or(usize::MAX) >= limit {
                continue;
            }
            for j in neighbors(self.state.w, self.state.h, cur)
                .into_iter()
                .flatten()
            {
                if j == except
                    || self.state.tiles[j] != TILE_FLOOR
                    || self.input.geometry.mask[j] == 0
                    || i64::from(self.state.scratch.mark[j]) == stamp
                {
                    continue;
                }
                self.state.scratch.mark[j] = stamp as i32;
                self.state.scratch.depth[j] = self.state.scratch.depth[cur].wrapping_add(1);
                self.state.scratch.qa[tail] = j as i32;
                tail += 1;
            }
        }
        false
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
            self.input.territory.expect("admitted territory")[i]
        } else {
            self.input.geometry.mask[i]
        }
    }
    fn joined_without(&mut self, i: usize, territory: bool, value: u8) -> bool {
        let ends: Vec<_> = neighbors(self.state.w, self.state.h, i)
            .into_iter()
            .flatten()
            .filter(|&j| self.state.tiles[j] == TILE_FLOOR && self.scope(j, territory) == value)
            .collect();
        if ends.len() <= 1 {
            return true;
        }
        let saved = self.state.tiles[i];
        self.state.tiles[i] = TILE_WALL;
        let ok = ends[1..]
            .iter()
            .all(|&u| self.joins(ends[0], u, territory, value));
        self.state.tiles[i] = saved;
        ok
    }
    fn joins(&mut self, s: usize, u: usize, territory: bool, value: u8) -> bool {
        let ma = self.state.scratch.stamp();
        let mb = self.state.scratch.stamp();
        let (mut ha, mut ta, mut hb, mut tb) = (0, 1, 0, 1);
        self.state.scratch.qa[0] = s as i32;
        self.state.scratch.mark[s] = ma as i32;
        self.state.scratch.qb[0] = u as i32;
        self.state.scratch.mark[u] = mb as i32;
        while ha < ta && hb < tb {
            let i = self.state.scratch.qa[ha] as usize;
            ha += 1;
            for j in neighbors(self.state.w, self.state.h, i)
                .into_iter()
                .flatten()
            {
                if self.state.tiles[j] != TILE_FLOOR || self.scope(j, territory) != value {
                    continue;
                }
                let m = i64::from(self.state.scratch.mark[j]);
                if m == mb {
                    return true;
                }
                if m != ma {
                    self.state.scratch.mark[j] = ma as i32;
                    self.state.scratch.qa[ta] = j as i32;
                    ta += 1;
                }
            }
            let i = self.state.scratch.qb[hb] as usize;
            hb += 1;
            for j in neighbors(self.state.w, self.state.h, i)
                .into_iter()
                .flatten()
            {
                if self.state.tiles[j] != TILE_FLOOR || self.scope(j, territory) != value {
                    continue;
                }
                let m = i64::from(self.state.scratch.mark[j]);
                if m == ma {
                    return true;
                }
                if m != mb {
                    self.state.scratch.mark[j] = mb as i32;
                    self.state.scratch.qb[tb] = j as i32;
                    tb += 1;
                }
            }
        }
        false
    }
    pub fn can_surface(&self, i: i32, kind: SurfaceKind) -> bool {
        let Some(i) = self.index(i) else {
            return false;
        };
        let s = &self.state;
        if self.input.geometry.mask[i] == 0
            || self.input.hard[i] != 0
            || s.tiles[i] != TILE_FLOOR
            || s.terrain[i] != self.kinds.none
        {
            return false;
        }
        if kind != SurfaceKind::Light {
            if self.input.no_block[i] == 1 {
                return false;
            }
            let o = s.feature_owner[i];
            if o != 0 && s.features[usize::from(o) - 1].kind == FeatureKind::Landmark {
                return false;
            }
        }
        if matches!(kind, SurfaceKind::Bog | SurfaceKind::Ice)
            && self.guard.as_ref().is_some_and(|g| g.corridor[i] == 1)
        {
            return false;
        }
        if matches!(kind, SurfaceKind::Bog | SurfaceKind::Light) {
            return true;
        }
        let (x, y) = ((i % s.w) as i32, (i / s.w) as i32);
        if kind == SurfaceKind::Ember {
            return (0..8).any(|q| {
                at(s.w, s.h, x + RING_DX[q], y + RING_DY[q])
                    .is_some_and(|j| s.tiles[j] == TILE_LOW && s.terrain[j] == self.kinds.lava)
            });
        }
        (0..8).all(|q| {
            at(s.w, s.h, x + RING_DX[q], y + RING_DY[q]).is_some_and(|j| s.tiles[j] == TILE_FLOOR)
        })
    }
    pub fn surface(&mut self, i: i32, kind: SurfaceKind) -> bool {
        if !self.can_surface(i, kind) {
            return false;
        }
        self.state.terrain[i as usize] = self.kinds.surface(kind);
        self.counters.surfaced += 1;
        true
    }
    pub fn prop(&mut self, kind: i32, x: i32, y: i32, v: u8) -> bool {
        let Some(i) = at(self.state.w, self.state.h, x, y) else {
            return false;
        };
        let cap = (f64::from(self.rules.prop_percent) * self.input.geometry.info.painted as f64
            / 100.0)
            .floor() as u64;
        if self.counters.props_added >= cap
            || self.input.geometry.mask[i] == 0
            || self.input.no_prop[i] != 0
        {
            return false;
        }
        let Some(k) = usize::try_from(kind)
            .ok()
            .filter(|&k| k < self.metadata.props.len())
        else {
            return false;
        };
        if self.state.tiles[i] != self.metadata.props[k].on
            || self.metadata.props[k]
                .home
                .is_some_and(|home| home != self.input.geometry.info.faction)
        {
            return false;
        }
        let tile = self.metadata.tile_size;
        self.state.props.push(MapProp {
            kind: k as u16,
            x: f64::from(x) * tile + tile / 2.0,
            y: f64::from(y) * tile + tile / 2.0,
            v,
        });
        self.counters.props_added += 1;
        true
    }
    /// Lazily build from current ground, exactly once. Call before shape writes when there are pool members.
    pub fn route_guard(&mut self) -> &RouteGuard {
        if self.guard.is_none() {
            self.guard = Some(RouteGuard::new_admitted(
                self.state,
                self.input.geometry,
                &self.input,
                self.rules.route_cut_off,
            ));
        }
        self.guard.as_ref().expect("built")
    }
    pub fn worst_stretch(&mut self, extra: &[i32]) -> i64 {
        self.route_guard();
        self.guard
            .as_mut()
            .expect("built")
            .worst_stretch(&self.state.tiles, extra)
    }
    /// Source safety net: counters and feature ownership intentionally are not refunded here.
    pub fn finish_shape(&mut self, before: usize) -> (usize, usize) {
        let mut components = before;
        let mut repaired = 0;
        if self.counters.walls + self.counters.lows > 0 {
            components = floor_components(&self.state.tiles, self.state.w, self.state.h)
                .expect("admitted grid")
                .1
                .len();
            if components > before {
                repaired = repair_connectivity(
                    &mut self.state.tiles,
                    &mut self.state.terrain,
                    &mut self.state.wrote,
                    self.state.w,
                    self.state.h,
                )
                .expect("admitted layers");
                components = floor_components(&self.state.tiles, self.state.w, self.state.h)
                    .expect("admitted grid")
                    .1
                    .len();
            }
        }
        (components, repaired)
    }
}
pub(crate) const DIAMOND2: [(i32, i32); 12] = [
    (0, -1),
    (1, 0),
    (0, 1),
    (-1, 0),
    (0, -2),
    (2, 0),
    (0, 2),
    (-2, 0),
    (1, -1),
    (1, 1),
    (-1, 1),
    (-1, -1),
];
fn at(w: usize, h: usize, x: i32, y: i32) -> Option<usize> {
    if x < 0 || y < 0 || x as usize >= w || y as usize >= h {
        None
    } else {
        Some(y as usize * w + x as usize)
    }
}
fn neighbors(w: usize, h: usize, i: usize) -> [Option<usize>; 4] {
    let (x, y) = (i % w, i / w);
    [
        if y > 0 { Some(i - w) } else { None },
        if x + 1 < w { Some(i + 1) } else { None },
        if y + 1 < h { Some(i + w) } else { None },
        if x > 0 { Some(i - 1) } else { None },
    ]
}
#[cfg(test)]
mod tests;
/// Source makeNoise.hash and fbm supplement the already accepted shared value-noise implementation.
pub fn noise_hash(noise: Noise, x: f64, y: f64, salt: f64) -> f64 {
    crate::mapgen::landmarks::recipe_support::hash2(
        x,
        y,
        (crate::mapgen::attempt::to_uint32(salt + f64::from(noise.stream_seed)) as i32) as f64,
    )
}
pub fn noise_fbm(noise: Noise, x: f64, y: f64, cell: f64, octaves: u32, salt: f64) -> f64 {
    let (mut sum, mut weight, mut amp, mut c) = (0.0, 0.0, 1.0, cell);
    for o in 0..octaves {
        sum += amp * noise.value(x, y, c, salt + f64::from(o) * 131.0);
        weight += amp;
        amp *= 0.5;
        c = if c * 0.5 < 1.0 { 1.0 } else { c * 0.5 };
    }
    sum / weight
}
