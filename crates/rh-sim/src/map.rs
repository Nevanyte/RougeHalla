//! The collision layer of a map (legacy `GameMap.tiles` and the query masks of `packages/shared/src/map.ts`). Read-only once
//! built; the derived tables (4-connected movement components) are computed once at construction, not per query.

use crate::constants::TILE;

pub const TILE_FLOOR: u8 = 0;
pub const TILE_WALL: u8 = 1;
pub const TILE_LOW: u8 = 2;
/// Eyes, projectiles, target acceptance: walls only.
pub const MASK_SIGHT: u8 = TILE_WALL;
/// Bodies, A*, placement: anything not floor.
pub const MASK_MOVE: u8 = 0xff;
/// Swings: walls and LOW (fences, lava, crevasses).
pub const MASK_MELEE: u8 = TILE_WALL | TILE_LOW;

#[derive(Clone, Debug, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct TileMap {
    pub w: u32,
    pub h: u32,
    pub tiles: Vec<u8>,
    /// 4-connected component id of every floor tile, -1 elsewhere (legacy `moveComponents`).
    #[serde(skip)]
    comps: Vec<i32>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum MapError {
    Shape { w: u32, h: u32, len: usize },
    BadRow { row: usize, len: usize },
    BadChar { row: usize, col: usize, ch: char },
}

impl std::fmt::Display for MapError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for MapError {}

impl TileMap {
    pub fn new(w: u32, h: u32, tiles: Vec<u8>) -> Result<Self, MapError> {
        if w == 0 || h == 0 || tiles.len() != (w as usize) * (h as usize) {
            return Err(MapError::Shape {
                w,
                h,
                len: tiles.len(),
            });
        }
        let comps = move_components(&tiles, w as usize, h as usize);
        Ok(Self { w, h, tiles, comps })
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

    /// Rebuilds the derived tables after deserialization (they are not serialized).
    pub fn rebuild(&mut self) {
        self.comps = move_components(&self.tiles, self.w as usize, self.h as usize);
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
    (v / TILE).floor() as i64
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
