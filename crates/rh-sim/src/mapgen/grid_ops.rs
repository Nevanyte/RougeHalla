//! Fixed-size generator connectivity. Walling log is appended in ascending tile order.
use super::coliseum::{TilePt, H, W};
pub use super::grid_topology::{RING_DX, RING_DY, SIMPLE};
pub const NB4: [i32; 4] = [-(W as i32), 1, W as i32, -1];
pub const RING_OFF: [i32; 8] = [
    -(W as i32),
    1 - W as i32,
    1,
    1 + W as i32,
    W as i32,
    W as i32 - 1,
    -1,
    -1 - W as i32,
];
pub fn enforce_connectivity(tiles: &mut [u8], seed: TilePt, mut log: Option<&mut Vec<usize>>) {
    let mut seen = vec![false; W * H];
    let mut queue = Vec::with_capacity(W * H);
    let start = seed.y as usize * W + seed.x as usize;
    // Legacy marks the seed even if it is blocked, then visits its floor neighbours.
    seen[start] = true;
    queue.push(start);
    let mut head = 0;
    while head < queue.len() {
        let i = queue[head];
        head += 1;
        let (x, y) = (i % W, i / W);
        let neighbours = [
            (x > 0, i.wrapping_sub(1)),
            (x < W - 1, i + 1),
            (y > 0, i.wrapping_sub(W)),
            (y < H - 1, i + W),
        ];
        for (inside, j) in neighbours {
            if inside && !seen[j] && tiles[j] & crate::map::MASK_MOVE == 0 {
                seen[j] = true;
                queue.push(j);
            }
        }
    }
    for (i, tile) in tiles.iter_mut().enumerate() {
        if *tile & crate::map::MASK_MOVE == 0 && !seen[i] {
            *tile = crate::map::TILE_WALL;
            if let Some(out) = log.as_mut() {
                out.push(i);
            }
        }
    }
}
