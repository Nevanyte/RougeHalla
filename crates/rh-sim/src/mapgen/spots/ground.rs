//! Actual terrain/landmark/camp/crate exclusion masks and three-pass ground placement.
use super::*;
/// Terrain-kind classes are borrowed from the terrain gate definition; None denotes an unknown kind.
pub struct GroundInput<'a> {
    pub fixed: &'a FixedLayout,
    pub tiles: &'a [u8],
    pub terrain: &'a [u8],
    pub terrain_on: &'a [Option<u8>],
    pub landmark_box: &'a [u8],
    pub clearing: &'a [usize],
    pub crates: &'a [usize],
    pub pool: &'a [usize],
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroundOutput {
    pub no_loot: Vec<u8>,
    pub near_spawn: Vec<u8>,
    pub cands: Vec<usize>,
    pub nooks: Vec<usize>,
    pub want: usize,
    pub chosen: Vec<usize>,
    pub refusal: Option<Refusal>,
}
pub fn ground_spots(
    input: GroundInput<'_>,
    rng: &mut impl FnMut() -> f64,
    d: &Definition,
) -> Result<GroundOutput, Error> {
    check(d)?;
    let GroundInput {
        fixed,
        tiles,
        terrain,
        terrain_on,
        landmark_box,
        clearing,
        crates,
        pool,
    } = input;
    lengths(&[tiles, terrain, landmark_box, &fixed.fp])?;
    indices(clearing)?;
    indices(crates)?;
    indices(pool)?;
    if terrain
        .iter()
        .any(|&t| t != 0 && terrain_on.get(t as usize).copied().flatten().is_none())
    {
        return Err(Error::TerrainKind);
    }
    let mut no_loot = vec![0; N];
    for i in 0..N {
        if landmark_box[i] != 0 || fixed.fp[i] != 0 || terrain[i] != 0 {
            no_loot[i] = 1
        }
    }
    for (i, &t) in terrain.iter().enumerate() {
        if t != 0 && terrain_on[t as usize] == Some(TILE_FLOOR) {
            mark(&mut no_loot, i, d.ground_hazard_margin)
        }
    }
    for &t in clearing {
        no_loot[t] = 1
    }
    for &t in crates {
        mark(&mut no_loot, t, d.ground_crate_margin)
    }
    let mut near_spawn = vec![0; N];
    for &t in pool {
        mark(&mut near_spawn, t, d.ground_spawn_margin)
    }
    let mut cands = Vec::new();
    let mut nooks = Vec::new();
    for y in 1..H - 1 {
        for x in 1..W - 1 {
            let i = y * W + x;
            if tiles[i] != TILE_FLOOR || no_loot[i] != 0 || near_spawn[i] != 0 {
                continue;
            }
            if open3(tiles, i) {
                cands.push(i)
            } else {
                nooks.push(i)
            }
        }
    }
    shuffle(rng, &mut cands);
    if cands.len() < d.ground_open_min {
        shuffle(rng, &mut nooks);
        cands.extend_from_slice(&nooks)
    }
    let wanted = want(rng, d.ground_min, d.ground_max);
    let mut chosen = Vec::new();
    for sep in d.ground_gaps {
        for &c in &cands {
            if chosen.len() >= wanted {
                break;
            }
            if !chosen.contains(&c) && chosen.iter().all(|&o| d2(o, c) >= sep * sep) {
                chosen.push(c)
            }
        }
    }
    let refusal = (chosen.len() < d.ground_min).then_some(Refusal::Ground);
    Ok(GroundOutput {
        no_loot,
        near_spawn,
        cands,
        nooks,
        want: wanted,
        chosen,
        refusal,
    })
}
