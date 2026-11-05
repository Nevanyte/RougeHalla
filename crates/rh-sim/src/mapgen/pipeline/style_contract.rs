//! The generator's post-hook contract and original-pool hazard clearing, in source order.
use super::{Error, H, W};
use crate::map::{TILE_FLOOR, TILE_LOW, TILE_WALL};
use crate::mapdata::{MapFeature, Zone};
use crate::mapgen::terrain_gate::TerrainGateDefinition;

pub(super) struct Input<'a> {
    pub before: &'a [u8],
    pub tiles: &'a [u8],
    pub terrain: &'a [u8],
    pub zone: &'a [u8],
    pub protect: &'a [u8],
    pub order: &'a [Zone],
    pub features: &'a [MapFeature],
    pub feature_owner: &'a [u16],
    pub gates: bool,
}

pub(super) fn check(
    input: &Input<'_>,
    kinds: &TerrainGateDefinition<'_>,
) -> Result<Option<String>, Error> {
    let Input {
        before,
        tiles,
        terrain,
        zone,
        protect,
        order,
        features,
        feature_owner,
        gates,
    } = *input;
    if [
        before.len(),
        tiles.len(),
        terrain.len(),
        zone.len(),
        protect.len(),
        feature_owner.len(),
    ]
    .into_iter()
    .any(|len| len != W * H)
    {
        return Err(Error::Leaf("style contract layer admission"));
    }
    for i in 0..W * H {
        let (t, k) = (tiles[i], terrain[i]);
        let breach = |why: String| {
            Some(format!(
                "zone style hook broke the contract at tile {},{}: {why}",
                i % W,
                i / W,
            ))
        };
        if t != before[i]
            && (before[i] != TILE_FLOOR
                || ![TILE_WALL, TILE_LOW].contains(&t)
                || zone[i] == 0
                || protect[i] != 0)
        {
            return Ok(breach(format!("tile {} -> {t}", before[i])));
        }
        if (t != before[i] || k != 0) && gates {
            let owner = usize::from(feature_owner[i]);
            let home = zone[i]
                .checked_sub(1)
                .and_then(|z| order.get(usize::from(z)));
            let owned = owner.checked_sub(1).and_then(|o| features.get(o));
            if !home.is_some_and(|home| owned.is_some_and(|feature| feature.zone == *home)) {
                return Ok(breach("a change no feature of the zone owns".into()));
            }
        }
        if k == 0 {
            continue;
        }
        let class = kinds.kinds.get(usize::from(k)).and_then(|spec| spec.tile);
        if zone[i] == 0
            || protect[i] != 0
            || !(class == Some(t) || (class == Some(TILE_LOW) && t == TILE_WALL))
        {
            return Ok(breach(format!("terrain {k} on tile {t}")));
        }
    }
    Ok(None)
}

/// T8 uses the original pool's 5x5 mask, before safety nets and before any spawn drops.
pub(super) fn clear_pool_hazards(
    terrain: &mut [u8],
    pool5: &[u8],
    kinds: &TerrainGateDefinition<'_>,
) -> Result<(), Error> {
    if terrain.len() != W * H || pool5.len() != W * H {
        return Err(Error::Leaf("style pool hazard layer admission"));
    }
    for (k, &protected) in terrain.iter_mut().zip(pool5) {
        if protected != 0 && *k != 0 {
            let spec = kinds
                .kinds
                .get(usize::from(*k))
                .ok_or(Error::Leaf("style pool terrain admission"))?;
            if spec.tile == Some(TILE_FLOOR) {
                *k = 0;
            }
        }
    }
    Ok(())
}
