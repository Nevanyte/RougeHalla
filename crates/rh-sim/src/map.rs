//! The collision layer of a map (legacy `GameMap.tiles` and the query masks of `packages/shared/src/map.ts`). Read-only once
//! built; the derived tables (4-connected movement components, the A* step mask) are computed once at construction, not
//! per query.
//!
//! Every way to obtain a [`TileMap`] goes through [`TileMap::new`]: deserialization too (`serde(try_from)`), so a decoded
//! map is either complete (shape checked, derived tables built) or an `Err`. It is never a value that panics on first use.
//! Equality and authoritative serialization include admitted gameplay layers, never the derived navigation tables.

use crate::constants::TILE;

pub const TILE_FLOOR: u8 = 0;
pub const TILE_WALL: u8 = 1;
pub const TILE_LOW: u8 = 2;
/// The query masks are content rows (`constants::MASK_*`, hashed with the rest of the rules): sight (eyes, projectiles,
/// target acceptance: walls only), movement (bodies, A*, placement: anything not floor) and melee (swings: walls and LOW
/// cover, fences, lava, crevasses). Re-exported here, where the tile classes they select from are.
pub use crate::constants::{MASK_MELEE, MASK_MOVE, MASK_SIGHT};

/// A* neighbour order (legacy `findPath`): the four orthogonal steps, then the four diagonals. Bit `d` of
/// [`TileMap::nav`] refers to step `(STEP_DX[d], STEP_DY[d])`.
pub const STEP_DX: [i64; 8] = [1, -1, 0, 0, 1, 1, -1, -1];
pub const STEP_DY: [i64; 8] = [0, 0, 1, -1, 1, -1, 1, -1];

/// The internal serialized form is `{w, h, tiles, layers}` (null when absent; derived tables are not serialized); decoding goes through
/// [`TileMapRepr`] and [`TileMap::new`].
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "TileMapRepr")]
pub struct TileMap {
    // Read-only by convention: the derived tables below are built from these three at construction, so a map is changed by
    // building a new one with `TileMap::new` (privacy is a follow-up: the fields are read across crates).
    pub w: u32,
    pub h: u32,
    pub tiles: Vec<u8>,
    /// Optional admitted public gameplay layers. Exposed read-only so collision and metadata remain one map.
    layers: Option<std::sync::Arc<crate::mapdata::MapLayers>>,
    /// 4-connected component id of every floor tile, -1 elsewhere (legacy `moveComponents`).
    #[serde(skip)]
    comps: Vec<i32>,
    /// Per tile, bit `d` set when the A* step `(STEP_DX[d], STEP_DY[d])` from it is legal: the target is an in-bounds floor
    /// tile and, for a diagonal, both orthogonal neighbours it squeezes between are floor too (legacy corner rule).
    #[serde(skip)]
    nav: Vec<u8>,
    /// The tiles in a grid padded by one tile of 0xFF on every side ((w + 2) x (h + 2), row-major): a tile outside the map
    /// is blocked for every nonzero mask, so a ray that has left the start tile reads neighbours with one slice access and
    /// no bounds compare (see [`TileMap::padded_blocked`]).
    #[serde(skip)]
    padded: Vec<u8>,
}

/// The wire/checkpoint shape of a [`TileMap`]: exactly its serialized fields.
#[derive(serde::Deserialize)]
#[serde(rename = "TileMap", deny_unknown_fields)]
struct TileMapRepr {
    w: u32,
    h: u32,
    tiles: Vec<u8>,
    #[serde(default)]
    layers: Option<std::sync::Arc<crate::mapdata::MapLayers>>,
}

impl TryFrom<TileMapRepr> for TileMap {
    type Error = MapError;
    fn try_from(r: TileMapRepr) -> Result<Self, MapError> {
        let map = TileMap::new(r.w, r.h, r.tiles)?;
        match r.layers {
            Some(layers) => map.with_layers(layers),
            None => Ok(map),
        }
    }
}

impl PartialEq for TileMap {
    fn eq(&self, o: &Self) -> bool {
        // The derived tables are functions of these three, so they never need comparing.
        self.w == o.w && self.h == o.h && self.tiles == o.tiles && self.layers == o.layers
    }
}
impl Eq for TileMap {}
impl std::hash::Hash for TileMap {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.w.hash(state);
        self.h.hash(state);
        self.tiles.hash(state);
        // Equality still checks all metadata; collisions in this cheap public-map lookup hash are permitted.
        // The authoritative statics digest separately hashes the complete serialized layers.
        self.layers
            .as_ref()
            .map(|layers| layers.legacy_map_hash_u32())
            .hash(state);
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum MapError {
    Shape { w: u32, h: u32, len: usize },
    BadRow { row: usize, len: usize },
    BadChar { row: usize, col: usize, ch: char },
    Layers(String),
}

impl std::fmt::Display for MapError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for MapError {}

impl TileMap {
    /// Validates the shape (`w, h > 0`, `tiles.len() == w * h`, every tile index fits the pathfinder's `i32` node ids) and
    /// builds the derived tables.
    pub fn new(w: u32, h: u32, tiles: Vec<u8>) -> Result<Self, MapError> {
        let cells = (w as u64) * (h as u64);
        if w == 0 || h == 0 || tiles.len() as u64 != cells || cells > i32::MAX as u64 {
            return Err(MapError::Shape {
                w,
                h,
                len: tiles.len(),
            });
        }
        let comps = move_components(&tiles, w as usize, h as usize);
        let nav = nav_masks(&tiles, w as usize, h as usize);
        let padded = padded_tiles(&tiles, w as usize, h as usize);
        Ok(Self {
            w,
            h,
            tiles,
            layers: None,
            comps,
            nav,
            padded,
        })
    }

    /// Admits full static metadata against this exact collision grid and dimension pair.
    pub fn with_layers(
        mut self,
        layers: impl Into<std::sync::Arc<crate::mapdata::MapLayers>>,
    ) -> Result<Self, MapError> {
        let layers = layers.into();
        if layers.dimensions() != (self.w, self.h) {
            return Err(MapError::Layers(
                "metadata dimensions differ from collision map".into(),
            ));
        }
        layers
            .validate_for_tiles(&self.tiles)
            .map_err(|error| MapError::Layers(error.to_string()))?;
        self.layers = Some(layers);
        Ok(self)
    }

    /// Runtime-only derived geometry. Canonical layer admission remains against the open map.
    pub(crate) fn closed_gates(&self) -> Option<Self> {
        let layers = self.layers.as_ref()?;
        if layers.dimensions() != (self.w, self.h)
            || self.tiles.len() as u64 != u64::from(self.w) * u64::from(self.h)
        {
            return None;
        }
        if layers
            .coliseum()
            .gates
            .iter()
            .all(|gate| gate.tiles.is_empty())
        {
            return None;
        }
        let mut tiles = self.tiles.clone();
        for gate in &layers.coliseum().gates {
            for at in &gate.tiles {
                // Layer admission already checked every gate coordinate against these dimensions.
                *tiles.get_mut((at.y as usize) * self.w as usize + at.x as usize)? = TILE_WALL;
            }
        }
        let mut map =
            Self::new(self.w, self.h, tiles).expect("derived geometry has unchanged dimensions");
        map.layers = self.layers.clone();
        Some(map)
    }

    pub fn layers(&self) -> Option<&crate::mapdata::MapLayers> {
        self.layers.as_deref()
    }

    /// Parses the fixture/row form: `#` wall, `~` low, `.` floor.
    pub fn from_rows<S: AsRef<str>>(rows: &[S]) -> Result<Self, MapError> {
        let h = rows.len();
        let w = rows
            .first()
            .map(|r| r.as_ref().chars().count())
            .unwrap_or(0);
        let mut tiles = Vec::with_capacity(w * h);
        for (y, r) in rows.iter().enumerate() {
            let r = r.as_ref();
            if r.chars().count() != w {
                return Err(MapError::BadRow {
                    row: y,
                    len: r.chars().count(),
                });
            }
            for (x, ch) in r.chars().enumerate() {
                tiles.push(match ch {
                    '#' => TILE_WALL,
                    '~' => TILE_LOW,
                    '.' => TILE_FLOOR,
                    _ => return Err(MapError::BadChar { row: y, col: x, ch }),
                });
            }
        }
        Self::new(w as u32, h as u32, tiles)
    }

    #[inline]
    pub fn tile(&self, tx: i64, ty: i64) -> Option<u8> {
        if tx < 0 || ty < 0 || tx >= self.w as i64 || ty >= self.h as i64 {
            None
        } else {
            Some(self.tiles[(ty as usize) * (self.w as usize) + tx as usize])
        }
    }

    /// Out of bounds counts as blocked for every mask.
    #[inline]
    pub fn blocked(&self, tx: i64, ty: i64, mask: u8) -> bool {
        match self.tile(tx, ty) {
            None => true,
            Some(t) => t & mask != 0,
        }
    }

    #[inline]
    pub fn is_floor(&self, tx: i64, ty: i64) -> bool {
        self.tile(tx, ty) == Some(TILE_FLOOR)
    }

    /// Solid for movement (legacy `isSolidTile`).
    #[inline]
    pub fn is_solid(&self, tx: i64, ty: i64) -> bool {
        self.blocked(tx, ty, MASK_MOVE)
    }

    #[inline]
    pub fn comp(&self, index: usize) -> i32 {
        self.comps[index]
    }

    /// The A* step mask of tile `index` (row-major): bit `d` set when the step `(STEP_DX[d], STEP_DY[d])` is legal.
    #[inline]
    pub fn nav(&self, index: usize) -> u8 {
        self.nav[index]
    }

    /// The padded grid's row stride (`w + 2`): the index step of one tile in y.
    #[inline]
    pub(crate) fn padded_stride(&self) -> isize {
        self.w as isize + 2
    }

    /// The padded-grid index of in-bounds tile `(tx, ty)`.
    #[inline]
    pub(crate) fn padded_index(&self, tx: i64, ty: i64) -> isize {
        (ty as isize + 1) * self.padded_stride() + tx as isize + 1
    }

    /// [`TileMap::blocked`] for a NONZERO `mask` by padded index: the ring around the map is 0xFF, so a tile outside the map
    /// is blocked exactly as `blocked` says. `index` must lie within one tile of the map (a ray that only ever moves one
    /// tile from an in-bounds tile); anything else panics on the slice access.
    #[inline]
    pub(crate) fn padded_blocked(&self, index: isize, mask: u8) -> bool {
        self.padded[index as usize] & mask != 0
    }

    /// The world size covered by the map, in world units.
    pub fn world_size(&self) -> (f64, f64) {
        (self.w as f64 * TILE, self.h as f64 * TILE)
    }

    /// 32-bit FNV-1a of the collision layer (size and tiles). The canonical public map is the server-sent layer set; this is
    /// its identity on the wire (docs/adr/0003-canonical-map.md). Not the legacy `mapHashU32`, which hashes more layers.
    pub fn layer_hash(&self) -> u32 {
        let mut h: u32 = 0x811c_9dc5;
        let mut eat = |b: u8| {
            h ^= b as u32;
            h = h.wrapping_mul(0x0100_0193);
        };
        for b in self.w.to_le_bytes().into_iter().chain(self.h.to_le_bytes()) {
            eat(b);
        }
        for &t in &self.tiles {
            eat(t);
        }
        h
    }
}

#[inline]
pub fn world_to_tile(v: f64) -> i64 {
    crate::math::floor_i64(v / TILE)
}

#[inline]
pub fn tile_to_world_center(t: i64) -> f64 {
    t as f64 * TILE + TILE / 2.0
}

fn move_components(tiles: &[u8], w: usize, h: usize) -> Vec<i32> {
    let n = w * h;
    let mut comp = vec![-1i32; n];
    let mut queue = vec![0usize; n];
    let mut id = 0;
    for s in 0..n {
        if tiles[s] != TILE_FLOOR || comp[s] >= 0 {
            continue;
        }
        let (mut head, mut tail) = (0, 0);
        queue[tail] = s;
        tail += 1;
        comp[s] = id;
        while head < tail {
            let i = queue[head];
            head += 1;
            let x = i % w;
            let visit =
                |j: usize, comp: &mut Vec<i32>, queue: &mut Vec<usize>, tail: &mut usize| {
                    if tiles[j] == TILE_FLOOR && comp[j] < 0 {
                        comp[j] = id;
                        queue[*tail] = j;
                        *tail += 1;
                    }
                };
            if x > 0 {
                visit(i - 1, &mut comp, &mut queue, &mut tail);
            }
            if x < w - 1 {
                visit(i + 1, &mut comp, &mut queue, &mut tail);
            }
            if i >= w {
                visit(i - w, &mut comp, &mut queue, &mut tail);
            }
            if i < n - w {
                visit(i + w, &mut comp, &mut queue, &mut tail);
            }
        }
        id += 1;
    }
    let _ = h;
    comp
}

/// The tiles inside a ring of 0xFF (see [`TileMap::padded_blocked`]).
fn padded_tiles(tiles: &[u8], w: usize, h: usize) -> Vec<u8> {
    let pw = w + 2;
    let mut pad = vec![0xFFu8; pw * (h + 2)];
    for (y, row) in tiles.chunks_exact(w).enumerate() {
        pad[(y + 1) * pw + 1..(y + 1) * pw + 1 + w].copy_from_slice(row);
    }
    pad
}

/// The A* step masks (see [`TileMap::nav`]): exactly the bounds, floor and corner tests the legacy inner loop makes per
/// neighbour, evaluated once per tile instead of once per expansion. A floor grid padded with one non-floor ring turns the
/// bounds tests into plain loads (about 40 instructions per tile, so building it is a small fraction of `from_rows`).
fn nav_masks(tiles: &[u8], w: usize, h: usize) -> Vec<u8> {
    let pw = w + 2;
    let mut pad = vec![0u8; pw * (h + 2)];
    for (y, row) in tiles.chunks_exact(w).enumerate() {
        let dst = &mut pad[(y + 1) * pw + 1..(y + 1) * pw + 1 + w];
        for (d, &t) in dst.iter_mut().zip(row) {
            *d = (t == TILE_FLOOR) as u8;
        }
    }
    let mut nav = vec![0u8; w * h];
    for (y, out) in nav.chunks_exact_mut(w).enumerate() {
        // Rows above, at and below y in the padded grid; column x of the map is column x + 1 there.
        let up = &pad[y * pw..(y + 1) * pw];
        let at = &pad[(y + 1) * pw..(y + 2) * pw];
        let dn = &pad[(y + 2) * pw..(y + 3) * pw];
        for (x, o) in out.iter_mut().enumerate() {
            let (e, wv, s, n) = (at[x + 2], at[x], dn[x + 1], up[x + 1]);
            // Bit order = STEP_DX/STEP_DY: E, W, S (+y), N (-y), then SE, NE, SW, NW, each diagonal needing both of the
            // orthogonal tiles it squeezes between.
            *o = e
                | wv << 1
                | s << 2
                | n << 3
                | (dn[x + 2] & e & s) << 4
                | (up[x + 2] & e & n) << 5
                | (dn[x] & wv & s) << 6
                | (up[x] & wv & n) << 7;
        }
    }
    nav
}

#[cfg(test)]
impl TileMap {
    /// Declared noncanonical source LOS guard only; never admission, restore, or production geometry.
    pub(crate) fn source_collision_fixture(&self, tiles: Vec<u8>) -> Self {
        let mut map = Self::new(self.w, self.h, tiles).expect("declared fixture collision");
        map.layers = self.layers.clone();
        map
    }

    /// Uncertified legacy helper map only. Never used by native admission or restore tests.
    pub(crate) fn source_terrain_fixture(mut self, terrain: Vec<u8>) -> Self {
        self.layers = Some(std::sync::Arc::new(crate::mapdata::source_terrain_fixture(
            self.w, self.h, terrain,
        )));
        self
    }
}
