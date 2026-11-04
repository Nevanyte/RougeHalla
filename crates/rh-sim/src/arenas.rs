//! Arena sources: the map file format (`rh-map/1`, exported from the legacy generator by parity/legacy-capture) and a small
//! built-in practice arena for tests. Parsing the JSON text is the caller's (the core has no JSON dependency).

use crate::map::{tile_to_world_center, TileMap};
use crate::math::Vec2;
use crate::sim::Arena;

#[derive(Clone, Debug, serde::Deserialize)]
pub struct MapFile {
    pub format: String,
    pub seed: Option<u32>,
    pub rows: Vec<String>,
    pub spawns: Vec<[f64; 2]>,
}

impl MapFile {
    pub fn into_arena(self) -> Result<Arena, String> {
        if self.format != "rh-map/1" {
            return Err(format!("unknown map format {}", self.format));
        }
        let map = TileMap::from_rows(&self.rows).map_err(|e| e.to_string())?;
        Ok(Arena { map, spawns: self.spawns.iter().map(|s| Vec2::new(s[0], s[1])).collect() })
    }
}

/// A 48x32 walled room with pillars, a LOW fence and eight spawns: deterministic and small, for tests and benches.
pub fn practice_arena() -> Arena {
    let (w, h) = (48usize, 32usize);
    let mut rows = Vec::with_capacity(h);
    for y in 0..h {
        let mut r = String::with_capacity(w);
        for x in 0..w {
            let edge = x == 0 || y == 0 || x == w - 1 || y == h - 1;
            let pillar = (x % 12 == 6) && (y % 10 >= 4 && y % 10 <= 6);
            let fence = x == 24 && (12..=19).contains(&y);
            r.push(if edge || pillar { '#' } else if fence { '~' } else { '.' });
        }
        rows.push(r);
    }
    let map = TileMap::from_rows(&rows).expect("practice arena");
    let spawns = [(4, 4), (43, 4), (4, 27), (43, 27), (14, 15), (33, 15), (24, 4), (24, 27)]
        .iter()
        .map(|&(tx, ty)| Vec2::new(tile_to_world_center(tx), tile_to_world_center(ty)))
        .collect();
    Arena { map, spawns }
}
