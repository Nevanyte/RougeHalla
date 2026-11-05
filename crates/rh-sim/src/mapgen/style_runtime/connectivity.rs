use super::*;
/// Source kit.floorComponents, including exact left/right/up/down queue order.
pub fn floor_components(tiles: &[u8], w: usize, h: usize) -> Result<(Vec<i32>, Vec<usize>), Error> {
    let n = grid_size(w, h)?;
    if tiles.len() != n {
        return Err(Error::Layer);
    }
    let mut comp = vec![-1; n];
    let mut sizes = Vec::new();
    let mut q = vec![0; n];
    for s in 0..n {
        if tiles[s] != TILE_FLOOR || comp[s] >= 0 {
            continue;
        }
        let (mut head, mut tail) = (0, 1);
        q[0] = s;
        comp[s] = sizes.len() as i32;
        while head < tail {
            let i = q[head];
            head += 1;
            let nb = neighbors(w, h, i);
            for j in [nb[3], nb[1], nb[0], nb[2]].into_iter().flatten() {
                if tiles[j] == TILE_FLOOR && comp[j] < 0 {
                    comp[j] = sizes.len() as i32;
                    q[tail] = j;
                    tail += 1;
                }
            }
        }
        sizes.push(tail);
    }
    Ok((comp, sizes))
}
/// Source kit.repairConnectivity, not the generator's unrelated connectivity repair.
pub fn repair_connectivity(
    tiles: &mut [u8],
    terrain: &mut [u8],
    wrote: &mut [u8],
    w: usize,
    h: usize,
) -> Result<usize, Error> {
    let n = grid_size(w, h)?;
    if tiles.len() != n || terrain.len() != n || wrote.len() != n {
        return Err(Error::Layer);
    }
    let (mut comp, sizes) = floor_components(tiles, w, h)?;
    if sizes.len() <= 1 {
        return Ok(0);
    }
    let mut main = 0;
    for k in 1..sizes.len() {
        if sizes[k] > sizes[main] {
            main = k;
        }
    }
    let mut q = vec![0; n];
    let mut carved = 0;
    for k in 0..sizes.len() {
        if k == main {
            continue;
        }
        let mut prev = vec![-2; n];
        let (mut head, mut tail) = (0, 0);
        let mut hit = None;
        for i in 0..n {
            if comp[i] == k as i32 {
                q[tail] = i;
                tail += 1;
                prev[i] = -1;
            }
        }
        while head < tail && hit.is_none() {
            let i = q[head];
            head += 1;
            let nb = neighbors(w, h, i);
            for j in [nb[1], nb[3], nb[2], nb[0]].into_iter().flatten() {
                if prev[j] != -2 {
                    continue;
                }
                if tiles[j] == TILE_FLOOR {
                    if comp[j] == k as i32 {
                        continue;
                    }
                    prev[j] = i as i32;
                    hit = Some(j);
                    break;
                }
                if wrote[j] == 0 {
                    continue;
                }
                prev[j] = i as i32;
                q[tail] = j;
                tail += 1;
            }
        }
        if let Some(hit) = hit {
            let mut i = prev[hit];
            while i >= 0 && comp[i as usize] != k as i32 {
                let j = i as usize;
                if tiles[j] != TILE_FLOOR {
                    tiles[j] = TILE_FLOOR;
                    terrain[j] = 0;
                    wrote[j] = 0;
                    carved += 1;
                }
                comp[j] = main as i32;
                i = prev[j];
            }
            for c in &mut comp {
                if *c == k as i32 {
                    *c = main as i32;
                }
            }
        }
    }
    Ok(carved)
}
