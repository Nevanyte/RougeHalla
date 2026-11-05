//! Pure source `records` finalization over trusted generator layers, after the spawn gate.
//! This leaf neither generates nor certifies a map. Malformed references are refused before mutation.
use crate::constants::TILE;
use crate::map::TILE_FLOOR;
use crate::mapdata::*;
use crate::mapgen::coliseum::{FixedLayout, CX, CY, H, W};
use crate::mapgen::zones::{camps::CampSite, chamfer, ZoneDefinition};

mod rules;
pub use rules::{default_definition, visit_content, Definition, DEFAULT_DEFINITION};

pub struct Input<'a> {
    pub seed: i64,
    pub attempt: u64,
    pub tiles: &'a [u8],
    pub terrain: &'a [u8],
    pub props: &'a [MapProp],
    pub region_grid: &'a [u8],
    pub zone: &'a [u8],
    pub order: &'a [Zone],
    pub camps: &'a [CampSite],
    pub reach2: &'a [i32],
    pub pool: &'a [usize],
    pub crates_by_zone: &'a [Vec<usize>],
    pub landmark_box: &'a [u8],
    pub buildings: &'a [TileRect],
    pub ground_spots: &'a [WorldPt],
    pub drafts: &'a [MapFeature],
    pub feature_owner: &'a [u16],
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Metadata,
    Definition,
    Layers,
    Reference,
    Pole,
}
fn world(x: i32, y: i32) -> WorldPt {
    WorldPt {
        x: f64::from(x) * TILE + TILE / 2.0,
        y: f64::from(y) * TILE + TILE / 2.0,
    }
}
fn tile(i: usize) -> WorldPt {
    world((i % W) as i32, (i / W) as i32)
}
/// `territory` is the source's in-place Uint8 territory layer. On errors it is unchanged.
/// Draft bbox/count fields are deliberately ignored; final ownership alone defines them.
pub fn finalize(
    d: &Definition<'_>,
    zones: &ZoneDefinition,
    fixed: &FixedLayout,
    input: &Input<'_>,
    territory: &mut [u8],
) -> Result<GameMapData, Error> {
    let i = input;
    let n = W * H;
    if !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&i.seed)
        || i.attempt > 9_007_199_254_740_991
    {
        return Err(Error::Metadata);
    }
    if d.factions.len() != 5
        || i.order.len() != 5
        || !zones.camp_radius.is_finite()
        || zones.camp_radius < 0.0
    {
        return Err(Error::Definition);
    }
    for z in [
        Zone::Fire,
        Zone::Sentenced,
        Zone::Plague,
        Zone::Frost,
        Zone::Holy,
    ] {
        if d.factions.iter().filter(|v| v.0 == z).count() != 1
            || i.order.iter().filter(|&&v| v == z).count() != 1
        {
            return Err(Error::Definition);
        }
    }
    if [i.tiles, i.terrain, i.region_grid, i.zone, i.landmark_box]
        .iter()
        .any(|a| a.len() != n)
        || territory.len() != n
        || i.feature_owner.len() != n
    {
        return Err(Error::Layers);
    }
    if i.camps.len() > 255
        || i.drafts.len() > 255
        || i.crates_by_zone.len() != 5
        || i.reach2.len() != i.camps.len() + 1
        || territory.iter().any(|&v| usize::from(v) > i.camps.len())
        || i.feature_owner
            .iter()
            .any(|&v| usize::from(v) > i.drafts.len())
        || i.zone.iter().any(|&v| v > 5)
        || i.tiles.iter().any(|&v| v > 2)
        || i.region_grid.iter().any(|&v| v > 6)
        || i.camps
            .iter()
            .any(|c| c.zone == 0 || c.zone > 5 || c.site >= n || c.spots.iter().any(|&s| s >= n))
        || i.reach2.iter().any(|&r| r < 0)
        || i.pool.iter().any(|&p| p >= n || i.zone[p] == 0)
        || i.crates_by_zone.iter().flatten().any(|&p| p >= n)
        || fixed.painted.iter().any(|&p| p >= n)
    {
        return Err(Error::Reference);
    }
    let mut contract = Vec::new();
    for &(f, _) in d.factions {
        for (ci, c) in i.camps.iter().enumerate() {
            if i.order[usize::from(c.zone) - 1] == f {
                contract.push(ci);
            }
        }
    }
    let mut remap = vec![0; i.camps.len() + 1];
    for (a, &b) in contract.iter().enumerate() {
        remap[b + 1] = (a + 1) as u8;
    }
    let mut area = vec![0u32; i.camps.len() + 1];
    for (q, &t) in territory.iter().enumerate() {
        if t != 0 && i.tiles[q] == TILE_FLOOR {
            area[usize::from(t)] += 1;
        }
    }
    let mut per_zone = [0; 5];
    let camps: Vec<CampDef> = contract
        .iter()
        .map(|&ci| {
            let c = &i.camps[ci];
            let z = i.order[usize::from(c.zone) - 1];
            let p = tile(c.site);
            per_zone[usize::from(z.code()) - 1] += 1;
            CampDef {
                id: format!("{}-{}", z.as_str(), per_zone[usize::from(z.code()) - 1]),
                zone: z,
                x: p.x,
                y: p.y,
                r: zones.camp_radius * TILE,
                spots: c.spots.iter().map(|&s| tile(s)).collect(),
                elite_spot: if c.elite { 0 } else { -1 },
                chest: p,
                area: area[ci + 1],
                radius: crate::math::sqrt(f64::from(i.reach2[ci + 1])) * TILE,
            }
        })
        .collect();
    let spawn_pool: Vec<_> = i
        .pool
        .iter()
        .map(|&p| {
            let w = tile(p);
            ZoneSpawn {
                x: w.x,
                y: w.y,
                zone: i.order[usize::from(i.zone[p]) - 1],
            }
        })
        .collect();
    let mut mask = vec![0; n];
    let mut dt = vec![0; n];
    let mut regions = Vec::new();
    for &(f, weapon) in d.factions {
        let z = i
            .order
            .iter()
            .position(|&v| v == f)
            .ok_or(Error::Definition)?
            + 1;
        let mut painted = 0;
        for &t in &fixed.painted {
            mask[t] = u8::from(usize::from(i.zone[t]) == z);
            painted += u32::from(mask[t]);
        }
        chamfer(&mask, &mut dt);
        let mut best = -1;
        let mut pole = None;
        for &t in &fixed.painted {
            if mask[t] != 0 && i.tiles[t] == TILE_FLOOR && i.landmark_box[t] == 0 && dt[t] > best {
                best = dt[t];
                pole = Some(t);
            }
        }
        let pole = pole.ok_or(Error::Pole)?;
        let mob_camps = camps
            .iter()
            .filter(|c| c.zone == f)
            .map(|c| MobCampDef {
                id: c.id.clone(),
                region: f,
                x: c.x,
                y: c.y,
                r: c.r,
                spots: c.spots.clone(),
                elite: c.elite_spot >= 0,
                weapon,
            })
            .collect();
        regions.push(FactionRegionDef {
            id: f,
            pole: tile(pole),
            area: painted,
            spawns: spawn_pool
                .iter()
                .filter(|s| s.zone == f)
                .map(|s| WorldPt { x: s.x, y: s.y })
                .collect(),
            chest_spots: i.crates_by_zone[z - 1].iter().map(|&t| tile(t)).collect(),
            mob_camps,
        });
    }
    let mut spawns = Vec::new();
    let mut k = 0;
    while spawns.len() < spawn_pool.len() {
        for r in &regions {
            if let Some(p) = r.spawns.get(k) {
                spawns.push(*p);
            }
        }
        k += 1;
    }
    let coliseum = ColiseumDef {
        rect: TileRect {
            x: fixed.co_rect.x,
            y: fixed.co_rect.y,
            w: fixed.co_rect.w as u32,
            h: fixed.co_rect.h as u32,
        },
        centre: world(CX, CY),
        gates: fixed
            .gates
            .iter()
            .map(|g| GateDef {
                side: match g.side {
                    super::coliseum::GateSide::North => GateSide::North,
                    super::coliseum::GateSide::East => GateSide::East,
                    super::coliseum::GateSide::South => GateSide::South,
                    super::coliseum::GateSide::West => GateSide::West,
                },
                tiles: g.tiles.iter().map(|t| TilePt { x: t.x, y: t.y }).collect(),
                x: g.x,
                y: g.y,
            })
            .collect(),
        inner_spawns: fixed.inner_tiles.iter().map(|t| world(t.x, t.y)).collect(),
    };
    let mut sorted: Vec<_> = (0..i.drafts.len()).collect();
    sorted.sort_by_key(|&k| {
        let f = &i.drafts[k];
        (
            d.factions.iter().position(|v| v.0 == f.zone).unwrap() * 2
                + usize::from(f.kind == FeatureKind::Infill),
            k,
        )
    });
    let mut ids = vec![0; i.drafts.len() + 1];
    for (k, &s) in sorted.iter().enumerate() {
        ids[s + 1] = k + 1;
    }
    let mut feature_grid = vec![0; n];
    let mut count = vec![0u32; ids.len()];
    let mut ice = vec![0; ids.len()];
    let mut bounds = vec![(W as i32, H as i32, -1, -1); ids.len()];
    for (q, grid_id) in feature_grid.iter_mut().enumerate() {
        let o = usize::from(i.feature_owner[q]);
        if o == 0 {
            continue;
        }
        let id = ids[o];
        *grid_id = id as u8;
        count[id] += 1;
        if i.terrain[q] == d.terrain_ice {
            ice[id] += 1;
        }
        let (x, y) = ((q % W) as i32, (q / W) as i32);
        let b = &mut bounds[id];
        b.0 = b.0.min(x);
        b.1 = b.1.min(y);
        b.2 = b.2.max(x);
        b.3 = b.3.max(y);
    }
    let features = sorted
        .iter()
        .enumerate()
        .map(|(n, &k)| {
            let mut f = i.drafts[k].clone();
            let id = n + 1;
            if matches!(f.kind, FeatureKind::Crater | FeatureKind::Bush) {
                if let Some(p) = f.p.first_mut() {
                    if *p >= 0 && (*p as usize) < i.camps.len() {
                        *p = i32::from(remap[*p as usize + 1]) - 1;
                    }
                }
            }
            if f.kind == FeatureKind::Mere && f.p.len() > 1 {
                f.p[1] = ice[id];
            }
            let b = bounds[id];
            f.bbox = if count[id] > 0 {
                TileRect {
                    x: b.0,
                    y: b.1,
                    w: (b.2 - b.0 + 1) as u32,
                    h: (b.3 - b.1 + 1) as u32,
                }
            } else {
                TileRect {
                    x: f.ax,
                    y: f.ay,
                    w: 0,
                    h: 0,
                }
            };
            f.tiles = count[id];
            f
        })
        .collect();
    for t in territory.iter_mut() {
        *t = remap[usize::from(*t)];
    }
    Ok(GameMapData {
        seed: i.seed,
        attempt: i.attempt,
        w: W as u32,
        h: H as u32,
        tiles: i.tiles.to_vec(),
        terrain: i.terrain.to_vec(),
        props: i.props.to_vec(),
        region_grid: i.region_grid.to_vec(),
        territory_grid: territory.to_vec(),
        coliseum,
        camps,
        spawn_pool,
        spawns,
        crate_spots: regions
            .iter()
            .flat_map(|r| r.chest_spots.iter().copied())
            .collect(),
        regions,
        buildings: i.buildings.to_vec(),
        ground_spots: i.ground_spots.to_vec(),
        features,
        feature_grid,
    })
}
#[cfg(test)]
mod tests;
