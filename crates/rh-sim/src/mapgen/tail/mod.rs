//! Pure stage-ten terrain nets, post-loot decor/exclusion and the final generator shape gate.
//! This is generator acceptance, distinct from the independent finished-map certifier.
use crate::constants::TILE;
use crate::map::{TILE_FLOOR, TILE_WALL};
use crate::mapdata::{MapProp, WorldPt};
use crate::mapgen::coliseum::{H, W};
use crate::mapgen::grid_ops::{RING_DX, RING_DY};
use crate::mapgen::spawns::mark_rect;
use crate::mapgen::terrain_gate::TerrainGateDefinition;

#[derive(Clone, Copy, Debug)]
pub struct Definition {
    pub wall_piece_min: usize,
    pub loot_margin: i32,
}
pub const DEFAULT_DEFINITION: Definition = Definition {
    wall_piece_min: 6,
    loot_margin: 1,
};
pub fn default_definition() -> Definition {
    DEFAULT_DEFINITION
}
pub fn visit_content(d: &Definition, mut word: impl FnMut(u64)) {
    word(d.wall_piece_min as u64);
    word(d.loot_margin as u64);
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Layers,
    Codes,
    Definition,
    Positions,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    Unowned,
    WallPiece,
}
impl Refusal {
    pub fn source_reason(self) -> &'static str {
        match self {
            Self::Unowned => "A:unowned",
            Self::WallPiece => "A:wallPiece",
        }
    }
}
fn definition(d: &Definition) -> Result<(), Error> {
    if d.wall_piece_min == 0
        || d.wall_piece_min > W * H
        || d.loot_margin < 0
        || d.loot_margin as usize >= W.min(H)
    {
        return Err(Error::Definition);
    }
    Ok(())
}
fn tiles_valid(tiles: &[u8]) -> Result<(), Error> {
    if tiles.len() != W * H {
        return Err(Error::Layers);
    }
    if tiles.iter().any(|&t| t > 2) {
        return Err(Error::Codes);
    }
    Ok(())
}
fn world_tile(point: WorldPt) -> Option<usize> {
    let x = (point.x / TILE).floor();
    let y = (point.y / TILE).floor();
    if x >= 0.0 && y >= 0.0 && x < W as f64 && y < H as f64 {
        Some(y as usize * W + x as usize)
    } else {
        None
    }
}
/// Source stage ten runs only when a style hook ran. Invalid layers are refused before any mutation.
pub fn clear_terrain(
    kinds: &TerrainGateDefinition<'_>,
    styled: bool,
    tiles: &[u8],
    terrain: &mut [u8],
    props: &mut Vec<MapProp>,
) -> Result<usize, Error> {
    tiles_valid(tiles)?;
    if terrain.len() != W * H {
        return Err(Error::Layers);
    }
    if usize::from(kinds.ice) >= kinds.kinds.len() || kinds.ice == 0 {
        return Err(Error::Definition);
    }
    if terrain.iter().any(|&t| usize::from(t) >= kinds.kinds.len()) {
        return Err(Error::Codes);
    }
    if !styled {
        return Ok(0);
    }
    for (&tile, kind) in tiles.iter().zip(terrain.iter_mut()) {
        if *kind != 0
            && tile == TILE_WALL
            && kinds.kinds[usize::from(*kind)].tile == Some(TILE_FLOOR)
        {
            *kind = 0;
        }
    }
    let mut cleared = 0;
    for (i, kind) in terrain.iter_mut().enumerate() {
        if *kind != kinds.ice {
            continue;
        }
        let (x, y) = (i % W, i / W);
        let bad = x == 0
            || y == 0
            || x == W - 1
            || y == H - 1
            || RING_DX.iter().zip(RING_DY).any(|(&dx, dy)| {
                let j = (y as i32 + dy) as usize * W + (x as i32 + dx) as usize;
                tiles[j] != TILE_FLOOR
            });
        if bad {
            *kind = 0;
            cleared += 1;
        }
    }
    props.retain(|p| {
        let Some(i) = world_tile(WorldPt { x: p.x, y: p.y }) else {
            return false;
        };
        kinds
            .props
            .get(usize::from(p.kind))
            .is_some_and(|spec| tiles[i] == spec.on)
    });
    Ok(cleared)
}
fn mark(mask: &mut [u8], tile: usize, margin: i32) {
    mark_rect(
        mask,
        crate::mapgen::coliseum::TileRect {
            x: (tile % W) as i32,
            y: (tile / W) as i32,
            w: 1,
            h: 1,
        },
        margin,
    );
}
/// Preserve source prop order; the returned mask is exactly the original pre-bush loot exclusion.
/// Original picked pool members remain protected even if the later spawn gate drops them.
pub fn clear_loot_decor(
    d: &Definition,
    pool: &[usize],
    crates: &[usize],
    ground: &[WorldPt],
    props: &mut Vec<MapProp>,
) -> Result<Vec<u8>, Error> {
    definition(d)?;
    if pool.iter().chain(crates).any(|&p| p >= W * H) {
        return Err(Error::Positions);
    }
    let ground: Vec<_> = ground
        .iter()
        .copied()
        .map(world_tile)
        .collect::<Option<_>>()
        .ok_or(Error::Positions)?;
    let mut avoid = vec![0; W * H];
    for &p in crates.iter().chain(&ground) {
        mark(&mut avoid, p, d.loot_margin);
    }
    if !props.is_empty() {
        let mut clear = avoid.clone();
        for &p in pool {
            mark(&mut clear, p, d.loot_margin);
        }
        props.retain(|p| world_tile(WorldPt { x: p.x, y: p.y }).is_some_and(|i| clear[i] == 0));
    }
    Ok(avoid)
}
/// Source first checks every unowned blocker, then same-zone eight-connected WALL components.
pub fn shape_gate(
    d: &Definition,
    tiles: &[u8],
    feature_grid: &[u8],
    zone: &[u8],
) -> Result<Option<Refusal>, Error> {
    definition(d)?;
    tiles_valid(tiles)?;
    if feature_grid.len() != W * H || zone.len() != W * H {
        return Err(Error::Layers);
    }
    if zone.iter().any(|&z| z > 5) {
        return Err(Error::Codes);
    }
    for i in 0..W * H {
        if zone[i] != 0 && tiles[i] != TILE_FLOOR && feature_grid[i] == 0 {
            return Ok(Some(Refusal::Unowned));
        }
    }
    let mut seen = vec![false; W * H];
    let mut queue = Vec::with_capacity(W * H);
    for start in 0..W * H {
        if seen[start] || zone[start] == 0 || tiles[start] != TILE_WALL {
            continue;
        }
        queue.clear();
        queue.push(start);
        seen[start] = true;
        let mut head = 0;
        while head < queue.len() {
            let i = queue[head];
            head += 1;
            let (x, y) = ((i % W) as i32, (i / W) as i32);
            for (&dx, dy) in RING_DX.iter().zip(RING_DY) {
                let (nx, ny) = (x + dx, y + dy);
                if nx < 0 || ny < 0 || nx >= W as i32 || ny >= H as i32 {
                    continue;
                }
                let j = ny as usize * W + nx as usize;
                if !seen[j] && zone[j] == zone[start] && tiles[j] == TILE_WALL {
                    seen[j] = true;
                    queue.push(j);
                }
            }
        }
        if queue.len() < d.wall_piece_min {
            return Ok(Some(Refusal::WallPiece));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests;
